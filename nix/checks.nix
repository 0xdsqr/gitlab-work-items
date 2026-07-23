{
  bun,
  nodeModules,
  package,
  pkgs,
  source,
  treefmtCheck,
}:
let
  workspaceCheck =
    name: command:
    pkgs.stdenvNoCC.mkDerivation {
      pname = "gitlab-work-items-${name}";
      inherit (package) version;
      src = source;
      nativeBuildInputs = [
        bun
        pkgs.nodejs_24
      ];
      dontConfigure = true;
      buildPhase = ''
        cp -R ${nodeModules}/node_modules .
        cp -R ${nodeModules}/apps/. apps/
        cp -R ${nodeModules}/packages/. packages/
        for executable in node_modules/.bin/*; do
          target="$(readlink -f "$executable")"
          if [ -f "$target" ]; then
            patchShebangs "$target"
          fi
        done
        ${command}
      '';
      installPhase = ''
        touch "$out"
      '';
    };
in
{
  inherit package;
  actions =
    pkgs.runCommand "gitlab-work-items-actions" { nativeBuildInputs = [ pkgs.actionlint ]; }
      ''
        actionlint ${source}/.github/workflows/*.yml
        touch "$out"
      '';
  formatting = treefmtCheck;
  lint = workspaceCheck "lint" "bun run lint";
  packaged-smoke =
    pkgs.runCommand "gitlab-work-items-packaged-smoke"
      {
        nativeBuildInputs = [ pkgs.expect ];
      }
      ''
        test ! -e ${package}/lib/gitlab-work-items/node_modules/typescript
        test ! -e ${package}/lib/gitlab-work-items/packages
        export GLWI_MOCK=1
        export TERM=xterm-256color

        expect <<'EOF'
          log_user 0
          set timeout 10
          stty rows 24 columns 80
          spawn -noecho ${package}/bin/gitlab-work-items
          expect {
            -re {4 work items synced} {}
            timeout {
              puts stderr "Packaged TUI did not render mock data within 10 seconds"
              exit 1
            }
            eof {
              puts stderr "Packaged TUI exited before rendering mock data"
              exit 1
            }
          }
          send -- "q"
          expect {
            eof {}
            timeout {
              puts stderr "Packaged TUI did not exit after q within 10 seconds"
              exit 1
            }
          }
          set wait_status [wait]
          set exit_status [lindex $wait_status 3]
          if {$exit_status != 0} {
            puts stderr "Packaged TUI exited with status $exit_status"
            exit $exit_status
          }
        EOF

        touch "$out"
      '';
  test = workspaceCheck "test" "bun run test";
  typecheck = workspaceCheck "typecheck" "bun run typecheck";
}
