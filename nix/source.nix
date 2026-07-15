{ lib }:
lib.fileset.toSource {
  root = ../.;
  fileset = lib.fileset.unions [
    ../.github
    ../apps
    ../packages
    ../.env.example
    ../.oxfmtrc.json
    ../.oxlintrc.json
    ../bun.lock
    ../package.json
  ];
}
