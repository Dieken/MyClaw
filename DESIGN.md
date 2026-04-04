# MyClaw - A local development environment for LLM agents and applications

## Purpose

MyClaw is inspired by OpenClaw but targets technical professionals, aiming to deliver secure and reliable programs. Here is its workflow:

1. Users create a new project or select an existing one through the MyClaw TUI;
2. MyClaw creates or checks out the project on a privately deployed Forgejo instance;
3. MyClaw launches AI-assisted programming tools such as Claude Code, Codex, and OpenCode, and users describe their requirements;
4. The AI-assisted programming tools analyze requirements, write design documents, break down tasks, write code, test, and release;
5. MyClaw deploys and runs the program, delivering the results;

## Design

### Containers

MyClaw creates the following containers:

1. Git container: Uses [Forgejo](https://forgejo.org/) to provide Git service;
2. LLM API proxy container: Uses [Bifrost](https://www.getmaxim.ai/bifrost) to protect the actual API keys and monitor/audit LLM API requests and responses;
3. HTTP proxy container: Uses Proxy.py to proxy HTTP and HTTPS traffic, identify source containers using DNS PTR records, and dynamically populate actual Authorization and Cookie HTTP headers to prevent authentication credentials from being exposed to the runtime environment;
4. Dev container: One development container per project;
5. Run container: One production container per project;

All containers use latest stable [Debian](https://www.debian.org/) release as the container image.

### Accounts

Each project has an independent set of accounts:

1. Git project `MyClaw/myclaw-<project>` is created and owned by MyClaw using an administrator account;
2. Git project developer account `myclaw-<project>` with write permissions only for the Git `repository MyClaw/myclaw-<project>`, the credential is stored in `~/.git-credentials`;
3. Virtual API key for LLM API proxy used by development containers, stored in `~/.bashrc.d/00-bifrost.sh` in the container;
4. Virtual API key for LLM API proxy used by production containers, stored in `~/.bashrc.d/00-bifrost.sh` in the container;

### Coding Standards

1. Each project can use the following technology stacks:
   * TypeScript + Deno: directly import remote module from https://jsr.io;
   * Scala 3: Use Scala-CLI's file header comment method to declare dependencies;
   * Python 3: Use PEP 723's file header comment method to declare dependencies;
2. Each project can contain multiple single-file programs;
3. Each program is placed directly in the project's root directory;

### Directory Structure

File directory structure used by MyClaw at runtime:

1. `~/myclaw-work` - Default MyClaw working directory;
2. `~/myclaw-work/infra/myclaw-infra-forgejo/home/myclaw` - Forgejo container's home directory, mounted to `/home/myclaw` in the container;
3. `~/myclaw-work/infra/myclaw-infra-bifrost/home/myclaw` - Bifrost container's home directory, mounted to `/home/myclaw` in the container;
4. `~/myclaw-work/projects/myclaw-run-<project>/home/myclaw` - Project runtime home directory, mounted to `/home/myclaw` in the container;
5. `~/myclaw-work/projects/myclaw-dev-<project>/home/myclaw` - Project development home directory, mounted to `/home/myclaw` in the container;
6. `~/myclaw-work/share/myclaw-dev/home/myclaw/<dir>` - Shared directories by all development containers;

## Security

Compared to OpenClaw, MyClaw's security comes from the following aspects:

1. MyClaw uses traditional software development processes rather than ad hoc real-time coding, making it easier to obtain reliable and reusable code;
2. Code development and runtime occur in different environments, especially not related to IM channels, to reduce the risk exposure surface;
3. Code runtime is in a fixed state rather than being driven by an agent loop that can rewrite its own behavior at any time, making code behavior more secure;
4. Authentication credentials are injected by network proxy, which the code cannot directly access, thus preventing credential leakage;
5. Code changes are version controlled, facilitating traceability and auditing;
