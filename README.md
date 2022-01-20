# Force Bridge

![integration-ci workflow](https://github.com/nervosnetwork/force-bridge/actions/workflows/integration-ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/nervosnetwork/force-bridge/branch/main/graph/badge.svg)](https://codecov.io/gh/nervosnetwork/force-bridge)

> This project is still in active development.

A general new designed Force Bridge.

- It can connect to all chains which support multiple signature account and
  Non-fungible token transfer. We plan to support EOS, TRON, BTC, Cardano and Polkadot in the first stage.
- You have to trust the committee who runs the bridge.

## Quick Start (NixOS)

Enable the podman daemon, this is will do all the work of docker while also
playing nicely with nixos on VMs and WSL (if you are on non-nixos you will have to find out how to get/run this daemon).

``` nix
# In your configuration.nix
virtualisation.podman.enable = true;
virtualisation.podman.dockerCompat = true;
virtualisation.podman.dockerSocket.enable = true;
```

Also make sure you are part of the podman group:

``` nix
users.users.${defaultUser} = {
    ...
    extraGroups = [ ... "podman" ];
};
```

After that just run

``` bash
nix-shell
```

In the directory source directory, and you are good to go!

Verify things are working by running the ci integration test

``` bash
make local-ci
```

### Running locally

``` bash
# run the bridge server manually
cd offchain-modules
yarn install
cp config.json.example config.json
```

The default config uses some directories we probably don't want, you are going to want
to change the logFile location to something local or at least in ~ and you are going to wanna change the keystore path as well.

To launch a verifier database (see the config.json entry for "orm")
you can just do: 

``` bash
docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'create database <database>'"
```

And to remove it:

``` bash
docker exec docker_mysql_1 bash -c "mysql -uroot -proot -e 'drop database if exists <database>'"
```

Where \<database\> is the database entry in the orm part of your config. We may change this to use something more our speed like postgresql, but for now this is what is in the box of force-bridge.

> These commands were adapted from offchain-modules/packages/scripts/src/integration.ts in the handleDb function line 29, and will likely get boxed up into something later.

After you have some form of database running that matches your spec you are free to run force-bridge by doing:

``` bash
yarn start
```

When you are in the offchain-modules directory.

Now you are free to hack on force-bridge.

### Troubleshooting `yarn start`

If yarn start fails, there is no error telling you why, only that it failed. So here are the biggest 3 things:
- Your keystore file doesn't exist: Make sure your keystore file actually exists, even if it is empty or just contains `{}`
- Your paths aren't absolute paths: Yes you heard me, make sure your paths are absolute, don't ~ do /home/\<username\>
- Your database isn't started or the name of it doesn't match in the config you created: Fix that, also check the port etc and that the database is running.
- You must set the environment variable CONFIG_PATH to the full path to your config.json created in the copy step
- Make local-ci has to have been run before you can interact with the docker_mysql_1 container
- Ensure your keystore has a {}
- Commiting code doesn't work unless you do it from the nix-shell

## Quick Start (Non NixOS)

### Install Development Tools

- `docker`: https://docs.docker.com/get-docker/
- `docker-compose`: https://docs.docker.com/compose/install/
- `Node.js`: https://nodejs.org/en/
- `rust`(optional): https://www.rust-lang.org/learn/get-started

```bash
# install capsule with cargo
cargo install capsule --git https://github.com/nervosnetwork/capsule.git --tag v0.2.3
# or download the binary and put it in you PATH
# https://github.com/nervosnetwork/capsule/releases/v0.2.3

# run the integration test with docker
make local-ci

# run the bridge server manually
cd offchain-modules
yarn install
cp config.json.example config.json
# edit the config file on your demands
yarn start
```

### Install force-bridge cli

```bash
npm i -g @force-bridge/cli
```
