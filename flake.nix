{
  description = "GitLab work items terminal UI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    treefmt-nix.url = "github:numtide/treefmt-nix";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      treefmt-nix,
      ...
    }:
    flake-utils.lib.eachSystem
      [
        "aarch64-darwin"
        "x86_64-linux"
      ]
      (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          source = import ./nix/source.nix { inherit (pkgs) lib; };
          nodeModules = pkgs.callPackage ./nix/node-modules.nix { inherit source; };
          package = pkgs.callPackage ./nix/package.nix { inherit nodeModules source; };
          treefmtEval = treefmt-nix.lib.evalModule pkgs ./nix/treefmt.nix;
        in
        {
          formatter = treefmtEval.config.build.wrapper;

          devShells.default = import ./nix/devshell.nix {
            inherit pkgs;
            treefmtWrapper = treefmtEval.config.build.wrapper;
          };

          packages = {
            default = package;
            github-work-items = package;
            node-modules = nodeModules;
          };

          apps = import ./nix/apps.nix { inherit package pkgs system; };

          checks = import ./nix/checks.nix {
            inherit
              nodeModules
              package
              pkgs
              source
              ;
            treefmtCheck = treefmtEval.config.build.check self;
          };
        }
      );
}
