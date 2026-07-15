{
  bun,
  lib,
  source,
  stdenvNoCC,
}:
let
  hashes = builtins.fromJSON (builtins.readFile ./hashes.json);
in
stdenvNoCC.mkDerivation {
  pname = "github-work-items-node-modules";
  version = "0.1.0";
  src = source;

  nativeBuildInputs = [ bun ];

  dontConfigure = true;
  impureEnvVars = lib.fetchers.proxyImpureEnvVars;

  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
    bun install --frozen-lockfile --ignore-scripts --no-progress
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -R node_modules "$out/node_modules"
    find apps packages -type d -name node_modules -exec cp -R --parents {} "$out" \;
    runHook postInstall
  '';

  dontFixup = true;
  outputHashAlgo = "sha256";
  outputHashMode = "recursive";
  outputHash = hashes.nodeModules.${stdenvNoCC.hostPlatform.system};
}
