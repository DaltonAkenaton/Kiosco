-- ============================================================================
--  0014 · ENROLAMIENTO Y SINCRONIZACION  (bloque 5)
-- ============================================================================
--
--  Lo que necesitan las Edge Functions del kiosco (supabase/functions) y los
--  botones del panel que las acompanan:
--
--    PANEL (con su sesion de Supabase Auth, protegidas por rol):
--      generar_codigo_enrolamiento()     el papelito de 8 caracteres
--      revocar_dispositivo()             dar de baja un kiosco
--      establecer_credenciales_kiosco()  usuario y contrasena del modo admin
--
--    KIOSCO (solo a traves de Edge Functions, con service_role):
--      canjear_codigo_enrolamiento()     codigo -> dispositivo nuevo
--      recibir_registros()               marcas, eventos, accesos a fotos
--      catalogo_para_kiosco()            empleados, admins, config, ultimas marcas
--
--  ¿Por que generar y revocar son funciones de la base y no Edge Functions,
--  como decia el comentario de la 0004? Porque corren igual de protegidas
--  —del lado del servidor, con el generador aleatorio de pgcrypto— y se
--  prueban junto con el resto del esquema. La regla que importaba ("nunca
--  generar el codigo en el navegador") se cumple igual. Ver D-031.


-- ============================================================================
--  0. EL LATIDO TAMBIEN REPORTA EL DESFASE DEL RELOJ  (ARQUITECTURA.md 7)
-- ============================================================================
--  Cuanto se aparta la hora de Windows del kiosco de la del servidor. Un
--  kiosco con 20 minutos de desfase explica marcas "raras" antes de que el
--  jefe sospeche de alguien.
alter table dispositivos add column desfase_reloj_ms integer;


-- ============================================================================
--  1. CREDENCIALES DEL MODO ADMINISTRADOR DEL KIOSCO  (ARQUITECTURA.md 5.2)
-- ============================================================================
--
--  El kiosco valida al jefe SIN internet, asi que el hash de su contrasena
--  tiene que bajar a cada kiosco, igual que los PINes.
--
--  ¿Por que una contrasena APARTE de la del panel? Porque lo que baja al
--  kiosco se puede robar con el disco. Si fuera la misma que la del panel,
--  quien se lleve un kiosco podria probar contrasenas en su casa, sin limite
--  de intentos, y con la que adivine entraria al panel desde cualquier lado.
--  Separadas, lo peor que consigue es ver fotos... del kiosco que ya se robo.

alter table administradores
  add column usuario_kiosco text unique
    check (usuario_kiosco ~ '^[a-z][a-z0-9.]{2,29}$'),
  add column contrasena_kiosco_hash text
    check (contrasena_kiosco_hash like '$2%'),
  -- Las dos o ninguna: un usuario sin contrasena no sirve, y una contrasena
  -- sin usuario no se puede teclear.
  add constraint administradores_credenciales_kiosco_completas
    check ((usuario_kiosco is null) = (contrasena_kiosco_hash is null));

comment on column administradores.contrasena_kiosco_hash is
  'bcrypt, compatible con bcryptjs del kiosco. NO es la contrasena del panel, a proposito.';

create or replace function establecer_credenciales_kiosco(
  p_user_id    uuid,
  p_usuario    text,
  p_contrasena text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Cada administrador puede poner LAS SUYAS. Las de otro, solo el rol admin.
  if not (puede_administrar() or (p_user_id = auth.uid() and es_administrador())) then
    raise exception 'No puedes cambiar las credenciales de otra persona';
  end if;

  if lower(p_usuario) !~ '^[a-z][a-z0-9.]{2,29}$' then
    raise exception 'El usuario debe empezar con una letra y tener de 3 a 30 letras, numeros o puntos';
  end if;

  if length(p_contrasena) < 8 then
    raise exception 'La contrasena debe tener al menos 8 caracteres';
  end if;

  update administradores
     set usuario_kiosco         = lower(p_usuario),
         contrasena_kiosco_hash = extensions.crypt(p_contrasena, extensions.gen_salt('bf', 10))
   where user_id = p_user_id;

  if not found then
    raise exception 'No existe ese administrador';
  end if;
end;
$$;


-- ============================================================================
--  2. CODIGOS DE ENROLAMIENTO: nombre del kiosco y generacion
-- ============================================================================

-- El jefe decide como se llama el kiosco AL GENERAR el codigo ("Entrada
-- principal"). Asi quien lo instala solo teclea el codigo, y el nombre no
-- depende de lo que alguien escriba de prisa frente al kiosco.
alter table codigos_enrolamiento
  add column nombre_dispositivo text not null default '',
  add column ubicacion          text not null default '';

insert into configuracion (clave, valor, descripcion, grupo) values
  ('minutos_vigencia_codigo_enrolamiento', '15'::jsonb,
   'Cuanto dura un codigo para dar de alta un kiosco (ARQUITECTURA.md 3.3).',
   'dispositivos');

/*
  El alfabeto de los codigos: SIN letras que se confunden al dictarlas o
  leerlas en un papel (0/O, 1/I/L). 31 simbolos ^ 8 = ~850 mil millones de
  codigos; con 15 minutos de vida, adivinar uno es imposible en la practica.
*/
create or replace function generar_codigo_enrolamiento(
  p_nombre    text,
  p_ubicacion text default ''
)
returns table (codigo text, expira_en timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  largo    constant int  := length(alfabeto);
  v_codigo text := '';
  v_byte   int;
  v_expira timestamptz;
begin
  if not puede_administrar() then
    raise exception 'Solo un administrador puede dar de alta kioscos';
  end if;

  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Ponle un nombre al kiosco, por ejemplo "Entrada principal"';
  end if;

  /*
    Muestreo por rechazo: se descartan los bytes >= 248 (= 31 * 8). Sin eso,
    `byte % 31` favoreceria un poco a las primeras 8 letras, y un codigo con
    sesgo es un codigo mas facil de adivinar.
  */
  while length(v_codigo) < 8 loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    if v_byte < (256 / largo) * largo then
      v_codigo := v_codigo || substr(alfabeto, (v_byte % largo) + 1, 1);
    end if;
  end loop;

  v_expira := now() + make_interval(mins => coalesce(
    (select (valor #>> '{}')::int from configuracion where clave = 'minutos_vigencia_codigo_enrolamiento'),
    15
  ));

  insert into codigos_enrolamiento (codigo_hash, creado_por, expira_en, nombre_dispositivo, ubicacion)
  values (
    encode(extensions.digest(v_codigo, 'sha256'), 'hex'),
    auth.uid(),
    v_expira,
    trim(p_nombre),
    coalesce(trim(p_ubicacion), '')
  );

  -- El codigo en claro sale UNA vez, aqui. En la tabla solo queda su hash.
  return query select v_codigo, v_expira;
end;
$$;


-- ============================================================================
--  3. CANJEAR EL CODIGO  (lo llama la Edge Function `enrolar-kiosco`)
-- ============================================================================
--
--  Atomico: marcar el codigo como usado y crear el dispositivo pasan juntos o
--  no pasan. Dos kioscos tecleando el mismo codigo al mismo tiempo: el
--  `for update` hace esperar al segundo, que ya lo encuentra usado.
--
--  Recibe HASHES, nunca el codigo ni el token en claro: la Edge Function los
--  calcula, y asi ninguno de los dos llega a aparecer en un log de Postgres.

create or replace function canjear_codigo_enrolamiento(
  p_codigo_hash text,
  p_token_hash  text,
  p_version_app text
)
returns table (dispositivo_id uuid, nombre text, ubicacion text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo codigos_enrolamiento%rowtype;
  v_id     uuid;
begin
  select * into v_codigo
    from codigos_enrolamiento
   where codigo_hash = p_codigo_hash
     and usado_en is null
     and expira_en > now()
   for update;

  -- Inexistente, usado o vencido: los tres se responden igual (vacio). Decir
  -- cual fue le ayuda a quien esta probando codigos, no a quien instala.
  if not found then
    return;
  end if;

  insert into dispositivos (nombre, ubicacion, token_hash, enrolado_por, version_app, ultima_conexion)
  values (
    coalesce(nullif(v_codigo.nombre_dispositivo, ''), 'Kiosco'),
    v_codigo.ubicacion,
    p_token_hash,
    v_codigo.creado_por,
    p_version_app,
    now()
  )
  returning id into v_id;

  update codigos_enrolamiento
     set usado_en = now(), dispositivo_id = v_id
   where id = v_codigo.id;

  return query
    select d.id, d.nombre, d.ubicacion from dispositivos d where d.id = v_id;
end;
$$;


-- ============================================================================
--  4. REVOCAR UN KIOSCO  (boton del panel)
-- ============================================================================
--  Las tres columnas cambian juntas, que es justo lo que el CHECK
--  `dispositivos_revocacion_coherente` exige.

create or replace function revocar_dispositivo(p_dispositivo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not puede_administrar() then
    raise exception 'Solo un administrador puede dar de baja un kiosco';
  end if;

  update dispositivos
     set activo = false, revocado_en = now(), revocado_por = auth.uid()
   where id = p_dispositivo_id
     and activo;

  if not found then
    raise exception 'Ese kiosco no existe o ya estaba dado de baja';
  end if;
end;
$$;


-- ============================================================================
--  5. RECIBIR LO QUE MANDA UN KIOSCO  (Edge Function `recibir-registros`)
-- ============================================================================
--
--  Un lote: marcas, eventos, accesos a fotos y cambios de estado de fotos,
--  tal como los guarda la bandeja de salida del kiosco. La Edge Function ya
--  valido la forma de cada cosa y quien es el kiosco.
--
--  Reglas:
--    - IDEMPOTENTE. Cada cosa trae su UUID del kiosco. Si ya estaba, cuenta
--      como aceptada: el kiosco reintenta tras un corte y no debe duplicar
--      nada (ARQUITECTURA.md 7).
--    - UNA COSA MALA NO TUMBA EL LOTE. Cada una va en su propio bloque; si
--      falla, se rechaza ESA con su motivo y se sigue.
--    - KIOSCO REVOCADO (ARQUITECTURA.md 3.3): lo que paso ANTES de la revocacion se
--      acepta en cuarentena, con la bandera `dispositivo_revocado`. Lo de
--      despues se rechaza. Nunca se descarta en silencio.
--    - Las marcas van PRIMERO: un acceso a foto apunta a una marca, y puede
--      venir en el mismo lote.
--
--  Devuelve { "aceptados": [ids], "rechazados": [{ "id", "motivo" }] }.

create or replace function recibir_registros(
  p_dispositivo_id uuid,
  p_revocado_en    timestamptz,
  p_lote           jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aceptados  jsonb := '[]'::jsonb;
  v_rechazados jsonb := '[]'::jsonb;
  v_item       jsonb;
  v_id         uuid;
  v_hora       timestamptz;
  v_banderas   text[];
  v_foto_hash  text;
  v_estado     text;
begin
  -- -------------------------------------------------------------- marcas
  for v_item in select * from jsonb_array_elements(coalesce(p_lote -> 'marcas', '[]'::jsonb)) loop
    begin
      v_id   := (v_item ->> 'id')::uuid;
      v_hora := to_timestamp(((v_item -> 'reloj' ->> 'horaEstimadaMs')::bigint) / 1000.0);

      if p_revocado_en is not null and v_hora >= p_revocado_en then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'dispositivo_revocado');
        continue;
      end if;

      v_banderas := array(select jsonb_array_elements_text(coalesce(v_item -> 'banderas', '[]'::jsonb)));
      if p_revocado_en is not null then
        v_banderas := array_append(v_banderas, 'dispositivo_revocado');
      end if;

      -- El estado de la foto se deduce de lo que el kiosco ya sabia al
      -- guardar la marca. Despues puede cambiar (ver "estadosDeFoto").
      v_foto_hash := v_item ->> 'fotoHash';
      v_estado := case
        when v_foto_hash is null then 'sin_camara'
        when 'foto_obstruida' = any (v_banderas) then 'obstruida'
        else 'con_foto'
      end;

      insert into marcas (
        id, empleado_id, dispositivo_id, tipo, origen,
        hora_dispositivo, hora_estimada, monotonico_ms, arranque_id, desfase_servidor_ms,
        foto_hash, foto_estado, banderas, en_cuarentena
      ) values (
        v_id,
        (v_item ->> 'empleadoId')::uuid,
        p_dispositivo_id,
        v_item ->> 'tipo',
        'kiosco',  -- lo que llega por aqui SIEMPRE es del kiosco, diga lo que diga
        to_timestamp(((v_item -> 'reloj' ->> 'horaDispositivoMs')::bigint) / 1000.0),
        v_hora,
        round((v_item -> 'reloj' ->> 'monotonicoMs')::numeric)::bigint,  -- performance.now() trae decimales
        (v_item -> 'reloj' ->> 'arranqueId')::uuid,
        coalesce((v_item -> 'reloj' ->> 'desfaseServidorMs')::integer, 0),
        v_foto_hash,
        v_estado,
        v_banderas,
        p_revocado_en is not null
      )
      on conflict (id) do nothing;

      v_aceptados := v_aceptados || to_jsonb(v_id);
    exception
      when foreign_key_violation then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_item ->> 'id', 'motivo', 'empleado_desconocido');
      when others then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_item ->> 'id', 'motivo', 'datos_invalidos');
    end;
  end loop;

  -- ------------------------------------------------------------- eventos
  for v_item in select * from jsonb_array_elements(coalesce(p_lote -> 'eventos', '[]'::jsonb)) loop
    begin
      v_id   := (v_item ->> 'id')::uuid;
      v_hora := to_timestamp(((v_item -> 'reloj' ->> 'horaEstimadaMs')::bigint) / 1000.0);

      if p_revocado_en is not null and v_hora >= p_revocado_en then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'dispositivo_revocado');
        continue;
      end if;

      insert into eventos_dispositivo (id, dispositivo_id, tipo, detalle, ocurrido_en)
      values (v_id, p_dispositivo_id, v_item ->> 'tipo', coalesce(v_item -> 'detalle', '{}'::jsonb), v_hora)
      on conflict (id) do nothing;

      v_aceptados := v_aceptados || to_jsonb(v_id);
    exception
      when others then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_item ->> 'id', 'motivo', 'datos_invalidos');
    end;
  end loop;

  -- ------------------------------------------------------ accesos a fotos
  --  Se aceptan AUNQUE el kiosco este revocado y sin importar la fecha: son
  --  el rastro de quien miro que foto, y ese rastro vale mas que nunca justo
  --  cuando un kiosco se dio de baja.
  for v_item in select * from jsonb_array_elements(coalesce(p_lote -> 'accesosFoto', '[]'::jsonb)) loop
    begin
      v_id := (v_item ->> 'id')::uuid;

      insert into accesos_foto (id, marca_id, dispositivo_id, admin_id, accion, consultado_en)
      values (
        v_id,
        (v_item ->> 'marcaId')::uuid,
        p_dispositivo_id,
        (v_item ->> 'adminId')::uuid,
        v_item ->> 'accion',
        (v_item ->> 'consultadoEn')::timestamptz
      )
      on conflict (id) do nothing;

      v_aceptados := v_aceptados || to_jsonb(v_id);
    exception
      when foreign_key_violation then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_item ->> 'id', 'motivo', 'marca_desconocida');
      when others then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_item ->> 'id', 'motivo', 'datos_invalidos');
    end;
  end loop;

  -- -------------------------------------------------- estados de las fotos
  --  "Se borro a los 30 dias", "la marcaron Conservar", "falta", "alterada".
  --  Solo el kiosco que tomo la foto puede decir que le paso: es el unico
  --  que la tiene. Traen su propio id (el del renglon de la bandeja).
  for v_item in select * from jsonb_array_elements(coalesce(p_lote -> 'estadosDeFoto', '[]'::jsonb)) loop
    begin
      v_id := (v_item ->> 'id')::uuid;

      update marcas
         set foto_estado = v_item ->> 'estado'
       where id = (v_item ->> 'marcaId')::uuid
         and dispositivo_id = p_dispositivo_id;

      if not found then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'marca_desconocida');
      else
        v_aceptados := v_aceptados || to_jsonb(v_id);
      end if;
    exception
      when others then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_item ->> 'id', 'motivo', 'datos_invalidos');
    end;
  end loop;

  return jsonb_build_object('aceptados', v_aceptados, 'rechazados', v_rechazados);
end;
$$;


-- ============================================================================
--  6. EL CATALOGO QUE BAJA AL KIOSCO  (Edge Function `catalogo`)
-- ============================================================================
--
--  INCREMENTAL (ARQUITECTURA.md 7): con `p_desde`, solo lo que cambio despues. Los
--  empleados dados de baja TAMBIEN bajan, con `activo = false`: es la unica
--  forma de que el kiosco se entere de que tiene que desactivarlos.
--
--  La configuracion y las ultimas marcas bajan completas: son pocas filas
--  (13 claves, ~20 empleados) y asi el kiosco nunca queda con una mezcla.
--
--  `cursor` es lo que el kiosco debe mandar como `p_desde` la proxima vez.
--  Es el mayor `actualizado_en` que vio, no la hora del servidor: si se
--  usara `now()`, un cambio guardado mientras corria esta consulta se
--  perderia para siempre.

create or replace function catalogo_para_kiosco(p_desde timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
  emp as (
    select id, usuario, numero_empleado, nombre, apellido_paterno, apellido_materno,
           pin_hash, pin_temporal, activo, actualizado_en
      from empleados
     where p_desde is null or actualizado_en > p_desde
  ),
  adm as (
    select user_id as id, usuario_kiosco as usuario, nombre, contrasena_kiosco_hash as contrasena_hash,
           rol, activo, actualizado_en
      from administradores
     where usuario_kiosco is not null
       and (p_desde is null or actualizado_en > p_desde)
  ),
  ultimas as (
    select distinct on (empleado_id) empleado_id, tipo, hora_estimada
      from marcas
     order by empleado_id, hora_estimada desc
  )
  select jsonb_build_object(
    'empleados',       coalesce((select jsonb_agg(to_jsonb(emp)) from emp), '[]'::jsonb),
    'administradores', coalesce((select jsonb_agg(to_jsonb(adm)) from adm), '[]'::jsonb),
    'configuracion',   coalesce((select jsonb_object_agg(clave, valor) from configuracion), '{}'::jsonb),
    'ultimasMarcas',   coalesce((select jsonb_agg(jsonb_build_object(
                          'empleadoId', empleado_id, 'tipo', tipo, 'horaEstimada', hora_estimada))
                        from ultimas), '[]'::jsonb),
    'cursor', greatest(
      p_desde,
      (select max(actualizado_en) from emp),
      (select max(actualizado_en) from adm)
    )
  );
$$;


-- ============================================================================
--  7. QUIEN PUEDE LLAMAR QUE
-- ============================================================================
--  Las del kiosco, SOLO service_role (es decir, solo las Edge Functions). Un
--  administrador con sesion en el panel no tiene por que poder crear
--  dispositivos ni meter marcas "como si fuera un kiosco".
--
--  Postgres da permiso de ejecutar a PUBLIC por defecto: hay que quitarlo
--  explicitamente, o `authenticated` lo hereda.

revoke all on function canjear_codigo_enrolamiento(text, text, text) from public, anon, authenticated;
revoke all on function recibir_registros(uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function catalogo_para_kiosco(timestamptz) from public, anon, authenticated;

grant execute on function canjear_codigo_enrolamiento(text, text, text) to service_role;
grant execute on function recibir_registros(uuid, timestamptz, jsonb) to service_role;
grant execute on function catalogo_para_kiosco(timestamptz) to service_role;

-- Las del panel: cualquiera con sesion puede LLAMARLAS, y adentro cada una
-- comprueba el rol. anon (sin sesion) nunca.
revoke all on function generar_codigo_enrolamiento(text, text) from public, anon;
revoke all on function revocar_dispositivo(uuid) from public, anon;
revoke all on function establecer_credenciales_kiosco(uuid, text, text) from public, anon;
grant execute on function generar_codigo_enrolamiento(text, text) to authenticated;
grant execute on function revocar_dispositivo(uuid) to authenticated;
grant execute on function establecer_credenciales_kiosco(uuid, text, text) to authenticated;
