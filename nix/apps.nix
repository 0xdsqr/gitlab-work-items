{
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
        name = "github-work-items-${name}";
        runtimeInputs = [ pkgs.nix ];
        text = ''
          exec nix build --no-link --print-build-logs ".#checks.${system}.${check}" "$@"
        '';
      };
    in
    app "${command}/bin/github-work-items-${name}" description;

  allChecks = pkgs.writeShellApplication {
    name = "github-work-items-check";
    runtimeInputs = [ pkgs.nix ];
    text = ''
      exec nix flake check --print-build-logs "$@"
    '';
  };

  mock = pkgs.writeShellApplication {
    name = "github-work-items-mock";
    text = ''
      export GWI_MOCK=1
      exec ${package}/bin/github-work-items "$@"
    '';
  };
in
{
  default = app "${package}/bin/github-work-items" "Browse GitLab work items from the terminal";
  mock = app "${mock}/bin/github-work-items-mock" "Run the TUI with deterministic sample data";
  check = app "${allChecks}/bin/github-work-items-check" "Run every repository check";
  format-check = checkApp "format-check" "formatting" "Check formatting without changing files";
  lint = checkApp "lint" "lint" "Lint the TypeScript workspace";
  test = checkApp "test" "test" "Run the test suite";
  typecheck = checkApp "typecheck" "typecheck" "Type-check the TypeScript workspace";
}
