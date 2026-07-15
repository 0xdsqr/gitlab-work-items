{
  bun,
  makeWrapper,
  nodeModules,
  source,
  stdenvNoCC,
}:
stdenvNoCC.mkDerivation {
  pname = "github-work-items";
  version = "0.1.0";
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
    mkdir -p "$out/bin" "$out/lib/github-work-items/apps/tui"
    cp package.json "$out/lib/github-work-items/package.json"
    cp -R packages "$out/lib/github-work-items/packages"
    cp -R apps/tui/dist "$out/lib/github-work-items/apps/tui/dist"
    cp -R apps/tui/node_modules "$out/lib/github-work-items/apps/tui/node_modules"
    cp -R node_modules "$out/lib/github-work-items/node_modules"
    makeWrapper ${bun}/bin/bun "$out/bin/github-work-items" \
      --add-flags "$out/lib/github-work-items/apps/tui/dist/index.js"
    runHook postInstall
  '';

  meta.mainProgram = "github-work-items";
}
