{ pkgs ? import <nixpkgs> {} }:

with pkgs;

let
  dockerCompat = pkgs.runCommandNoCC "docker-podman-compat" {} ''
    mkdir -p $out/bin
    ln -s ${pkgs.podman}/bin/podman $out/bin/docker
  '';
in
mkShell {
  buildInputs = [
    dockerCompat
    pkgs.rustc
    pkgs.docker
    pkgs.docker-compose
    pkgs.nodejs
    pkgs.cargo
  ];
}
