{
  bun,
  lib,
  makeWrapper,
  nodeModules,
  source,
  stdenvNoCC,
  version,
  xdg-utils,
}:
let
  runtimePrograms = lib.optional stdenvNoCC.hostPlatform.isLinux xdg-utils;
  opentuiNativeName =
    if stdenvNoCC.hostPlatform.isDarwin && stdenvNoCC.hostPlatform.isAarch64 then
      "core-darwin-arm64"
    else if stdenvNoCC.hostPlatform.isLinux && stdenvNoCC.hostPlatform.isx86_64 then
      "core-linux-x64"
    else
      throw "Unsupported OpenTUI package platform: ${stdenvNoCC.hostPlatform.system}";
  opentuiNativePackage = "@opentui/${opentuiNativeName}";
  opentuiNativeLibrary =
    if stdenvNoCC.hostPlatform.isDarwin then "libopentui.dylib" else "libopentui.so";
in
stdenvNoCC.mkDerivation {
  pname = "gitlab-work-items";
  inherit version;
  src = source;

  nativeBuildInputs = [
    bun
    makeWrapper
  ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    cp -R ${nodeModules}/node_modules .
    cp -R ${nodeModules}/apps/. apps/
    cp -R ${nodeModules}/packages/. packages/
    bun run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    runtime_root="$out/lib/gitlab-work-items"
    core_root="$runtime_root/node_modules/@opentui/core"
    native_root="$runtime_root/node_modules/${opentuiNativePackage}"
    opentui_core="$(readlink -f apps/tui/node_modules/@opentui/core)"
    opentui_native="$(readlink -f "$(dirname "$opentui_core")/${opentuiNativeName}")"

    mkdir -p "$out/bin" "$runtime_root/dist" "$core_root" "$native_root"
    install -m444 apps/tui/dist/index.js "$runtime_root/dist/index.js"

    # The application bundle contains Solid, Effect, and the OpenTUI Solid
    # binding. Keep only the external OpenTUI core runtime and this platform's
    # native renderer instead of copying the workspace dependency tree.
    for runtime_file in \
      package.json \
      LICENSE \
      index.bun.js \
      testing.bun.js \
      chunk-bun-t2myhmwd.js \
      chunk-bun-tkm837n2.js \
      parser.worker.js
    do
      install -m444 "$opentui_core/$runtime_file" "$core_root/$runtime_file"
    done
    for runtime_file in package.json LICENSE index.bun.js ${opentuiNativeLibrary}; do
      install -m444 "$opentui_native/$runtime_file" "$native_root/$runtime_file"
    done

    makeWrapper ${bun}/bin/bun "$out/bin/gitlab-work-items" \
      --add-flags "$runtime_root/dist/index.js" \
      ${lib.optionalString (
        runtimePrograms != [ ]
      ) "--prefix PATH : ${lib.makeBinPath runtimePrograms}"}
    runHook postInstall
  '';

  meta = {
    description = "Keyboard-first terminal UI for GitLab work items";
    homepage = "https://github.com/0xdsqr/gitlab-work-items";
    mainProgram = "gitlab-work-items";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
}
