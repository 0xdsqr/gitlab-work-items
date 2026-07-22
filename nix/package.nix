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
    mkdir -p "$out/bin" "$out/lib/gitlab-work-items/apps/tui"
    cp package.json "$out/lib/gitlab-work-items/package.json"
    cp -R packages "$out/lib/gitlab-work-items/packages"
    cp -R apps/tui/dist "$out/lib/gitlab-work-items/apps/tui/dist"
    cp -R apps/tui/node_modules "$out/lib/gitlab-work-items/apps/tui/node_modules"
    cp -R node_modules "$out/lib/gitlab-work-items/node_modules"
    makeWrapper ${bun}/bin/bun "$out/bin/gitlab-work-items" \
      --add-flags "--preload" \
      --add-flags "$out/lib/gitlab-work-items/apps/tui/node_modules/@opentui/solid/scripts/preload.js" \
      --add-flags "$out/lib/gitlab-work-items/apps/tui/dist/index.js" \
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
