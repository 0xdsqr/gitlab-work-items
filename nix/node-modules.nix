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
  pname = "gitlab-work-items-node-modules";
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

    # Bun's isolated linker can race while creating this peer-dependency bin link.
    # Normalize it until https://github.com/oven-sh/bun/issues/30209 is fixed.
    normalized_browserslist_bin=0
    for bin_dir in node_modules/.bun/update-browserslist-db@*/node_modules/.bin; do
      if [ ! -d "$bin_dir" ]; then
        continue
      fi
      ln -sfn ../browserslist/cli.js "$bin_dir/browserslist"
      normalized_browserslist_bin=1
    done
    if [ "$normalized_browserslist_bin" -ne 1 ]; then
      echo "Could not normalize the update-browserslist-db bin link" >&2
      exit 1
    fi
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
