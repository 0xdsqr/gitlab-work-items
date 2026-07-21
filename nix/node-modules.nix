{
  bun,
  lib,
  source,
  stdenvNoCC,
  version,
}:
let
  hashes = builtins.fromJSON (builtins.readFile ./hashes.json);
  installCpu =
    if stdenvNoCC.hostPlatform.isAarch64 then
      "arm64"
    else if stdenvNoCC.hostPlatform.isx86_64 then
      "x64"
    else
      throw "Unsupported Bun dependency architecture: ${stdenvNoCC.hostPlatform.system}";
  installOs =
    if stdenvNoCC.hostPlatform.isDarwin then
      "darwin"
    else if stdenvNoCC.hostPlatform.isLinux then
      "linux"
    else
      throw "Unsupported Bun dependency platform: ${stdenvNoCC.hostPlatform.system}";
in
stdenvNoCC.mkDerivation {
  pname = "github-work-items-node-modules";
  inherit version;
  src = source;

  nativeBuildInputs = [ bun ];

  dontConfigure = true;
  impureEnvVars = lib.fetchers.proxyImpureEnvVars;

  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
    bun install --frozen-lockfile --ignore-scripts --no-progress --cpu ${installCpu} --os ${installOs}
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
