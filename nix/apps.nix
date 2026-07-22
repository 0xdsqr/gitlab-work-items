{
  bun,
  package,
  pkgs,
  system,
}:
let
  app = program: description: {
    type = "app";
    inherit program;
    meta = { inherit description; };
  };

  checkApp =
    name: check: description:
    let
      command = pkgs.writeShellApplication {
        name = "gitlab-work-items-${name}";
        runtimeInputs = [ pkgs.nix ];
        text = ''
          exec nix build --no-link --print-build-logs ".#checks.${system}.${check}" "$@"
        '';
      };
    in
    app "${command}/bin/gitlab-work-items-${name}" description;

  allChecks = pkgs.writeShellApplication {
    name = "gitlab-work-items-check";
    runtimeInputs = [ pkgs.nix ];
    text = ''
      exec nix flake check --print-build-logs "$@"
    '';
  };

  audit = pkgs.writeShellApplication {
    name = "gitlab-work-items-audit";
    runtimeInputs = [ bun ];
    text = ''
      exec bun audit --ignore=GHSA-4x5r-pxfx-6jf8 "$@"
    '';
  };

  mock = pkgs.writeShellApplication {
    name = "gitlab-work-items-mock";
    text = ''
      export GLWI_MOCK=1
      exec ${package}/bin/gitlab-work-items "$@"
    '';
  };
in
{
  default = app "${package}/bin/gitlab-work-items" "Browse GitLab work items from the terminal";
  mock = app "${mock}/bin/gitlab-work-items-mock" "Run the TUI with deterministic sample data";
  audit = app "${audit}/bin/gitlab-work-items-audit" "Audit locked Bun dependencies for known vulnerabilities";
  check = app "${allChecks}/bin/gitlab-work-items-check" "Run every repository check";
  format-check = checkApp "format-check" "formatting" "Check formatting without changing files";
  lint = checkApp "lint" "lint" "Lint the TypeScript workspace";
  test = checkApp "test" "test" "Run the test suite";
  typecheck = checkApp "typecheck" "typecheck" "Type-check the TypeScript workspace";
}
