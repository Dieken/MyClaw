#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run --allow-net

import { deepMerge } from "jsr:@std/collections/deep-merge";
import { format } from "jsr:@std/datetime";
import { parse, stringify } from "jsr:@std/toml";
import { Command } from "jsr:@cliffy/command";
import { copy, ensureDir } from "jsr:@std/fs";

type IncusConfig = {
  baseImage: string;
  runImageName: string;
  devImageName: string;
  runPackages: string[];
  devPackages: string[];
};

type ForgejoConfig = {
  containerName: string;
  packages: string[];
  setupForm: Record<string, string>;
};

type MyClawConfig = {
  workDir: string;
  projectsDir: string;
  incus: IncusConfig;
  forgejo: ForgejoConfig;
};

type MyClawSecret = {
  forgejoAdminToken: string;
};

const APP_NAME = "myclaw";
const HOME = Deno.env.get("HOME") ?? Deno.cwd();
const DEFAULT_WORK_DIR = `${HOME}/myclaw-work`;
const DEFAULT_PROJECTS_DIR = `${DEFAULT_WORK_DIR}/projects`;
const APK_REPO_CONF_PATH = "conf/etc/apk/repositories";

const DEFAULT_INCUS_CONFIG: IncusConfig = {
  baseImage: "images:alpine/3.23",
  runImageName: "myclaw-run",
  devImageName: "myclaw-dev",
  runPackages: [
    "bash",
    "byobu",
    "curl",
    "deno",
    "etckeeper",
    "fish",
    "git",
    "git-lfs",
    "neovim",
    "nodejs",
    "npm",
    "openjdk25",
    "python3",
    "ripgrep",
    "uv",
    "zellij",
    "zsh",
  ],
  devPackages: [
    "cargo",
    "go",
    "maven",
    "rust",
    "zig",
  ],
};

const DEFAULT_FORGEJO_CONFIG: ForgejoConfig = {
  containerName: "myclaw-infra-forgejo",
  packages: ["forgejo"],
  setupForm: {
    db_type: "sqlite3",
    db_host: "",
    db_user: "",
    db_passwd: "",
    db_name: "",
    ssl_mode: "disable",
    db_schema: "",
    db_path: "/var/lib/forgejo/db/forgejo.db",
    app_name: "MyClaw",
    app_slogan: "Beyond coding. We Forge.",
    repo_root_path: "/var/lib/forgejo/git",
    lfs_root_path: "/var/lib/forgejo/data/lfs",
    run_user: "forgejo",
    ssh_port: "22",
    http_port: "3000",
    log_root_path: "/var/log/forgejo",
    disable_registration: "on",
    enable_update_checker: "on",
    smtp_addr: "",
    smtp_port: "",
    smtp_from: "",
    smtp_user: "",
    smtp_passwd: "",
    offline_mode: "on",
    disable_gravatar: "on",
    enable_open_id_sign_in: "on",
    enable_open_id_sign_up: "on",
    require_sign_in_view: "on",
    default_keep_email_private: "on",
    default_allow_create_organization: "on",
    default_enable_timetracking: "on",
    no_reply_address: "noreply.localhost",
    password_algorithm: "pbkdf2_hi",
    admin_name: "root",
    admin_email: "root@noreply.localhost",
  },
};

const DEFAULT_CONFIG: MyClawConfig = {
  workDir: DEFAULT_WORK_DIR,
  projectsDir: DEFAULT_PROJECTS_DIR,
  incus: DEFAULT_INCUS_CONFIG,
  forgejo: DEFAULT_FORGEJO_CONFIG,
};

function randomToken(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function writeTextIfMissing(
  path: string,
  content: string,
  mode?: number,
): Promise<boolean> {
  if (await pathExists(path)) {
    return false;
  }
  await Deno.writeTextFile(
    path,
    content,
    mode === undefined ? undefined : { mode },
  );
  return true;
}

async function writeConfigTomlIfMissing(
  path: string,
  data: MyClawConfig,
): Promise<boolean> {
  const content = `${stringify(data as Record<string, unknown>)}\n`;
  return await writeTextIfMissing(path, content);
}

async function replaceFileInContainer(
  containerName: string,
  localFilePath: string,
  containerFilePath: string,
): Promise<boolean> {
  const localContent = await Deno.readTextFile(localFilePath);

  const currentContent = await captureCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "cat",
    containerFilePath,
  ]);

  if (currentContent === localContent) {
    console.log(`  File '${containerFilePath}' is identical, skipping.`);
    return true;
  }

  const statOutput = await captureCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "stat",
    "-c",
    "%a:%U:%G",
    containerFilePath,
  ]);

  let mode: string | undefined;
  let owner: string | undefined;
  let group: string | undefined;

  if (statOutput) {
    const parts = statOutput.trim().split(":");
    if (parts.length === 3) {
      mode = parts[0];
      owner = parts[1];
      group = parts[2];
    }
  }

  const timestamp = format(new Date(), "yyyyMMdd-HHmmss");
  const backupPath = `${containerFilePath}.bak-${timestamp}`;

  const backupSuccess = await runCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "cp",
    "-a",
    containerFilePath,
    backupPath,
  ]);

  if (!backupSuccess) {
    console.error(
      `  Warning: Could not backup '${containerFilePath}'`,
    );
  } else {
    console.log(`  Backed up '${containerFilePath}' to '${backupPath}'`);
  }

  const pushSuccess = await runCommand([
    "incus",
    "file",
    "push",
    localFilePath,
    `${containerName}${containerFilePath}`,
  ]);

  if (!pushSuccess) {
    console.error(`  Failed to push file ${localFilePath}`);
    return false;
  }

  if (mode) {
    const chmodSuccess = await runCommand([
      "incus",
      "exec",
      containerName,
      "--",
      "chmod",
      mode,
      containerFilePath,
    ]);
    if (!chmodSuccess) {
      console.error(
        `  Warning: Could not restore permissions for ${containerFilePath}`,
      );
    }
  }

  if (owner && group) {
    const chownSuccess = await runCommand([
      "incus",
      "exec",
      containerName,
      "--",
      "chown",
      `${owner}:${group}`,
      containerFilePath,
    ]);
    if (!chownSuccess) {
      console.error(
        `  Warning: Could not restore ownership for ${containerFilePath}`,
      );
    }
  }

  console.log(`  Replaced '${containerFilePath}' with '${localFilePath}'`);
  return true;
}

async function loadConfigToml(workDir: string): Promise<MyClawConfig> {
  const configPath = `${workDir}/config.toml`;
  let config: MyClawConfig;
  if (await pathExists(configPath)) {
    const raw = await Deno.readTextFile(configPath);
    const parsed = parse(raw) as Record<string, unknown>;
    config = deepMerge(DEFAULT_CONFIG, parsed) as MyClawConfig;
  } else {
    config = deepMerge(DEFAULT_CONFIG, {}) as MyClawConfig;
  }

  // sort and dedup packages
  config.incus.runPackages = Array.from(new Set(config.incus.runPackages))
    .sort();
  config.incus.devPackages = Array.from(new Set(config.incus.devPackages))
    .sort();
  config.forgejo.packages = Array.from(new Set(config.forgejo.packages)).sort();

  return config;
}

async function loadSecretToml(workDir: string): Promise<MyClawSecret> {
  const secretPath = `${workDir}/secret.toml`;
  if (await pathExists(secretPath)) {
    const raw = await Deno.readTextFile(secretPath);
    const parsed = parse(raw) as Record<string, unknown>;
    return parsed as MyClawSecret;
  }
  return { forgejoAdminToken: "" };
}

async function writeSecretToml(
  path: string,
  data: MyClawSecret,
): Promise<void> {
  const content = `${stringify(data as Record<string, unknown>)}\n`;
  await Deno.writeTextFile(path, content, { mode: 0o600 });
}

function validateProjectName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
}

async function runCommand(cmd: string[]): Promise<boolean> {
  const process = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "inherit",
    stderr: "inherit",
  });
  const result = await process.output();
  return result.success;
}

async function captureCommand(cmd: string[]): Promise<string> {
  const process = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "inherit",
  });
  const result = await process.output();
  const stdout = new TextDecoder().decode(result.stdout);
  return stdout;
}

async function incusImageExists(name: string): Promise<boolean> {
  const stdout = await captureCommand([
    "incus",
    "image",
    "list",
    "--format=json",
  ]);
  if (!stdout) return false;
  try {
    const images = JSON.parse(stdout) as Array<
      { aliases?: Array<{ name: string }> }
    >;
    return images.some((img) =>
      img.aliases?.some((alias) => alias.name === name)
    );
  } catch {
    return false;
  }
}

async function createRunImage(
  baseImage: string,
  imageName: string,
  packages: string[],
  repoConfPath: string,
  force: boolean,
): Promise<boolean> {
  if (!force && await incusImageExists(imageName)) {
    console.log(`  Image '${imageName}' already exists, skipping.`);
    return true;
  }
  if (force && await incusImageExists(imageName)) {
    console.log(`  Image '${imageName}' already exists, forcing rebuild...`);
  } else {
    console.log(`  Creating image '${imageName}' based on '${baseImage}'...`);
  }

  const containerName = `tmp-${imageName}-build-${
    format(new Date(), "yyyyMMdd-HHmmss")
  }`;

  const launchSuccess = await runCommand([
    "incus",
    "launch",
    baseImage,
    containerName,
  ]);
  if (!launchSuccess) {
    console.error(`  Failed to launch container ${containerName}`);
    return false;
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const replaceResult = await replaceFileInContainer(
      containerName,
      repoConfPath,
      "/etc/apk/repositories",
    );
    if (!replaceResult) {
      return false;
    }

    const updateSuccess = await runCommand([
      "incus",
      "exec",
      containerName,
      "--",
      "apk",
      "update",
    ]);
    if (!updateSuccess) {
      console.error(`  Failed to update apk`);
      return false;
    }
    console.log(`  apk updated.`);

    console.log(`  Installing packages ${packages.join(", ")}`);
    const installSuccess = await runCommand([
      "incus",
      "exec",
      containerName,
      "--",
      "apk",
      "add",
      ...packages,
    ]);
    if (!installSuccess) {
      console.error(`  Failed to install packages ${packages.join(", ")}`);
      return false;
    }
    console.log(`  Packages installed: ${packages.join(", ")}`);

    const groupSuccess = await runCommand([
      "incus",
      "exec",
      containerName,
      "--",
      "addgroup",
      "myclaw",
    ]);
    if (!groupSuccess) {
      console.error(`  Failed to create group 'myclaw'`);
      return false;
    }
    console.log(`  Group 'myclaw' created.`);

    const userSuccess = await runCommand([
      "incus",
      "exec",
      containerName,
      "--",
      "adduser",
      "-D",
      "-s",
      "/bin/bash",
      "-G",
      "myclaw",
      "myclaw",
    ]);
    if (!userSuccess) {
      console.error(`  Failed to create user 'myclaw'`);
      return false;
    }
    console.log(
      `  User 'myclaw' created with primary group 'myclaw' and bash login shell.`,
    );

    console.log(
      `  Publishing image '${containerName}' as alias '${imageName}'...`,
    );
    const publishSuccess = await runCommand([
      "incus",
      "publish",
      containerName,
      "--force",
      "--reuse",
      "--alias",
      imageName,
    ]);
    if (!publishSuccess) {
      console.error(
        `  Failed to publish image '${containerName}' as alias '${imageName}'`,
      );
      return false;
    }
    console.log(`  Image '${imageName}' created.`);

    return true;
  } finally {
    const deleteSuccess = await runCommand([
      "incus",
      "delete",
      "-f",
      containerName,
    ]);
    if (!deleteSuccess) {
      console.log(
        `  Warning: Could not delete temporary container ${containerName}`,
      );
    }
  }
}

async function createDevImage(
  baseImage: string,
  imageName: string,
  packages: string[],
  force: boolean,
): Promise<boolean> {
  if (!force && await incusImageExists(imageName)) {
    console.log(`  Image '${imageName}' already exists, skipping.`);
    return true;
  }
  if (force && await incusImageExists(imageName)) {
    console.log(`  Image '${imageName}' already exists, forcing rebuild...`);
  } else {
    console.log(
      `  Creating dev image '${imageName}' based on '${baseImage}'...`,
    );
  }

  const containerName = `tmp-${imageName}-build-${
    format(new Date(), "yyyyMMdd-HHmmss")
  }`;

  const launchSuccess = await runCommand([
    "incus",
    "launch",
    baseImage,
    containerName,
  ]);
  if (!launchSuccess) {
    console.error(`  Failed to launch container ${containerName}`);
    return false;
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const updateSuccess = await runCommand([
      "incus",
      "exec",
      containerName,
      "--",
      "apk",
      "update",
    ]);
    if (!updateSuccess) {
      console.error(`  Failed to update apk`);
      return false;
    }
    console.log(`  apk updated.`);

    console.log(`  Installing packages ${packages.join(", ")}`);
    const installSuccess = await runCommand([
      "incus",
      "exec",
      containerName,
      "--",
      "apk",
      "add",
      ...packages,
    ]);
    if (!installSuccess) {
      console.error(`  Failed to install packages ${packages.join(", ")}`);
      return false;
    }
    console.log(`  Packages installed: ${packages.join(", ")}`);

    console.log(
      `  Publishing image '${containerName}' as alias '${imageName}'...`,
    );
    const publishSuccess = await runCommand([
      "incus",
      "publish",
      containerName,
      "--force",
      "--reuse",
      "--alias",
      imageName,
    ]);
    if (!publishSuccess) {
      console.error(
        `  Failed to publish image '${containerName}' as alias '${imageName}'`,
      );
      return false;
    }
    console.log(`  Image '${imageName}' created.`);

    return true;
  } finally {
    const deleteSuccess = await runCommand([
      "incus",
      "delete",
      "-f",
      containerName,
    ]);
    if (!deleteSuccess) {
      console.log(
        `  Warning: Could not delete temporary container ${containerName}`,
      );
    }
  }
}

async function incusContainerExists(name: string): Promise<boolean> {
  const stdout = await captureCommand(["incus", "list", "--format=json"]);
  if (!stdout) return false;
  try {
    const containers = JSON.parse(stdout) as Array<{ name: string }>;
    return containers.some((c) => c.name === name);
  } catch {
    return false;
  }
}

async function mountHostDir(
  containerName: string,
  deviceName: string,
  source: string,
  path: string,
): Promise<boolean> {
  const success = await runCommand([
    "incus",
    "config",
    "device",
    "add",
    containerName,
    deviceName,
    "disk",
    `source=${source}`,
    `path=${path}`,
  ]);
  if (!success) {
    console.error(
      `  Failed to add ${deviceName} ${source} to ${containerName} ${path}`,
    );
    return false;
  }
  return true;
}

async function createForgejoContainer(
  workDir: string,
  imageName: string,
  forgejo: ForgejoConfig,
): Promise<void> {
  // (1) create Forgejo container
  const { containerName, packages } = forgejo;
  if (await incusContainerExists(containerName)) {
    console.log(`  Container '${containerName}' already exists, skipping.`);
    return;
  }

  // Create local directories for bind mounts
  const infraDir = `${workDir}/infra/${containerName}`;
  const etcForgejoDir = `${infraDir}/etc/forgejo`;
  const logForgejoDir = `${infraDir}/var/log/forgejo`;
  const libForgejoDir = `${infraDir}/var/lib/forgejo`;

  await ensureDir(etcForgejoDir);
  await ensureDir(logForgejoDir);
  await ensureDir(libForgejoDir);
  console.log(`  Created local directories for bind mounts at ${infraDir}`);

  console.log(
    `  Creating container '${containerName}' from image '${imageName}'...`,
  );

  const launchSuccess = await runCommand([
    "incus",
    "launch",
    imageName,
    containerName,
  ]);
  if (!launchSuccess) {
    console.error(`  Failed to launch container ${containerName}`);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Add bind mounts using incus config device add
  console.log(`  Adding bind mounts to container...`);
  if (
    !(await mountHostDir(containerName, "conf", etcForgejoDir, "/etc/forgejo"))
  ) {
    return;
  }
  if (
    !(await mountHostDir(
      containerName,
      "log",
      logForgejoDir,
      "/var/log/forgejo",
    ))
  ) {
    return;
  }
  if (
    !(await mountHostDir(
      containerName,
      "data",
      libForgejoDir,
      "/var/lib/forgejo",
    ))
  ) {
    return;
  }
  console.log(`  Bind mounts added successfully.`);

  // (2) install Forgejo packages
  console.log(`  Installing Forgejo packages...`);

  const updateSuccess = await runCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "apk",
    "update",
  ]);
  if (!updateSuccess) {
    console.error(`  Failed to update apk`);
    return;
  }
  console.log(`  apk updated.`);

  const installSuccess = await runCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "apk",
    "add",
    ...packages,
  ]);
  if (!installSuccess) {
    console.error(`  Failed to install packages ${packages.join(", ")}`);
    return;
  }
  console.log(`  Packages installed: ${packages.join(", ")}`);

  // (3) chown directories to forgejo:www-data
  console.log(`  Setting ownership of Forgejo directories...`);
  const chownSuccess = await runCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "chown",
    "-R",
    "forgejo:www-data",
    "/etc/forgejo",
    "/var/log/forgejo",
    "/var/lib/forgejo",
  ]);
  if (!chownSuccess) {
    console.error(`  Failed to set ownership`);
    return;
  }
  console.log(`  Ownership set to forgejo:www-data.`);

  // (4) start Forgejo service
  console.log(`  Starting Forgejo service...`);
  const startSuccess = await runCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "rc-service",
    "forgejo",
    "start",
  ]);
  if (!startSuccess) {
    console.error(`  Failed to start forgejo service`);
    return;
  }
  console.log(`  Forgejo service started.`);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // (5) enable Forgejo service on boot
  console.log(`  Enabling Forgejo service on boot...`);
  const enableSuccess = await runCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "rc-update",
    "add",
    "forgejo",
    "default",
  ]);
  if (!enableSuccess) {
    console.error(`  Failed to enable forgejo service`);
    return;
  }
  console.log(`  Forgejo service enabled on boot.`);

  // (6) resolve Forgejo container IPv4 address
  console.log(`  Resolving Forgejo container IPv4 address...`);
  const ipOutput = await captureCommand([
    "incus",
    "list",
    "-c4",
    containerName,
  ]);
  if (!ipOutput) {
    console.error(`  Failed to get Forgejo container IPv4`);
    return;
  }
  const forgejoIp = ipOutput.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0];
  if (!forgejoIp) {
    console.error(
      `  Could not parse Forgejo container IPv4 from:\n${ipOutput}`,
    );
    return;
  }
  console.log(`  Forgejo IPv4: ${forgejoIp}`);

  // (7) setup Forgejo service
  const versionUrl = `http://${forgejoIp}:3000/api/v1/version`;
  console.log(`  Checking Forgejo API endpoint: ${versionUrl}`);
  const versionResponse = await fetch(versionUrl);
  if (versionResponse.status === 404) {
    const forgejoAdminPassword = randomToken(16);
    console.warn(
      "  !!! WARNING: Forgejo admin password is displayed only once. Save it now.",
    );
    console.warn(
      `  !!! Forgejo admin username: ${forgejo.setupForm.admin_name}`,
    );
    console.log(`  !!! Forgejo admin password: ${forgejoAdminPassword}`);
    console.log(`  Forgejo not initialized yet, submitting setup form...`);
    const setupPayload = new URLSearchParams({
      ...forgejo.setupForm,
      domain: forgejo.containerName,
      app_url: `http://${forgejo.containerName}:3000/`,
      admin_passwd: forgejoAdminPassword,
      admin_confirm_passwd: forgejoAdminPassword,
    });
    const setupUrl = `http://${forgejoIp}:3000/`;
    const setupResponse = await fetch(setupUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: setupPayload.toString(),
    });
    if (!setupResponse.ok) {
      console.error(
        `  Forgejo setup request failed with status ${setupResponse.status}.`,
      );
      return;
    }
    console.log(`  Forgejo setup completed.`);

    await new Promise((resolve) => setTimeout(resolve, 5000));
    // (8) Create Forgejo admin token
    const adminUsername = forgejo.setupForm.admin_name;
    const tokenUrl =
      `http://${forgejoIp}:3000/api/v1/users/${adminUsername}/tokens`;
    const tokenPayload = {
      name: "forgejo-admin-token",
      scopes: [
        "write:admin",
        "read:misc",
        "write:organization",
        "write:repository",
      ],
    };
    const basicAuth = btoa(`${adminUsername}:${forgejoAdminPassword}`);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${basicAuth}`,
      },
      body: JSON.stringify(tokenPayload),
    });

    if (!tokenResponse.ok) {
      console.error(
        `  Failed to create Forgejo admin token: ${tokenResponse.status} ${await tokenResponse
          .text()}`,
      );
      return;
    }
    const tokenData = await tokenResponse.json();
    const forgejoAdminToken = tokenData.sha1;
    console.log(`  Forgejo admin token created: ${forgejoAdminToken}`);

    // (9) Create forgejo organization "MyClaw"
    const orgUrl = `http://${forgejoIp}:3000/api/v1/orgs`;
    const orgPayload = {
      username: "MyClaw",
      visibility: "limited",
    };
    const orgResponse = await fetch(orgUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `token ${forgejoAdminToken}`,
      },
      body: JSON.stringify(orgPayload),
    });
    if (!orgResponse.ok) {
      console.error(
        `  Failed to create Forgejo organization 'MyClaw': ${orgResponse.status} ${await orgResponse
          .text()}`,
      );
    } else {
      console.log(`  Forgejo organization 'MyClaw' created.`);
    }

    // (10) Save forgejoAdminToken to secret.toml
    const secretPath = `${workDir}/secret.toml`;
    const secretData = await loadSecretToml(workDir);
    secretData.forgejoAdminToken = forgejoAdminToken;
    await writeSecretToml(secretPath, secretData);
    console.log(`  Forgejo admin token saved to ${secretPath}`);
  } else {
    console.log(
      `  Forgejo API check returned HTTP ${versionResponse.status}, skipping setup.`,
    );
  }

  console.log(`  Container '${containerName}' created successfully.`);
}

async function createBifrostContainer(
  workDir: string,
  imageName: string,
): Promise<void> {
  const containerName = "myclaw-infra-bifrost";
  if (await incusContainerExists(containerName)) {
    console.log(`  Container '${containerName}' already exists, skipping.`);
    return;
  }

  // Create local directories for bind mounts
  const infraDir = `${workDir}/infra/${containerName}`;
  const homeMyclawDir = `${infraDir}/home/myclaw`;
  await ensureDir(homeMyclawDir);
  console.log(`  Created local directories for bind mounts at ${infraDir}`);

  // Sync conf/home/myclaw to homeMyclawDir if it exists
  const confHomeMyclawDir = `conf/home/myclaw`;
  if (await pathExists(confHomeMyclawDir)) {
    console.log(`  Syncing ${confHomeMyclawDir} to ${homeMyclawDir}...`);
    try {
      await copy(confHomeMyclawDir, homeMyclawDir, {
        overwrite: true,
        preserveTimestamps: true,
      });
      console.log(`  Synced to ${homeMyclawDir}.`);
    } catch (error) {
      console.error(`  Failed to sync to ${homeMyclawDir}: ${error}`);
      return;
    }
  } else {
    console.log(
      `  Directory ${confHomeMyclawDir} does not exist, skipping sync.`,
    );
  }

  console.log(
    `  Creating container '${containerName}' from image '${imageName}'...`,
  );

  const launchSuccess = await runCommand([
    "incus",
    "launch",
    imageName,
    containerName,
  ]);
  if (!launchSuccess) {
    console.error(`  Failed to launch container ${containerName}`);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Add bind mount for homeMyclawDir
  console.log(`  Adding bind mount for ${homeMyclawDir}...`);
  if (
    !(await mountHostDir(
      containerName,
      "home-myclaw",
      homeMyclawDir,
      "/home/myclaw",
    ))
  ) {
    return;
  }
  console.log(`  Bind mount added successfully.`);

  // Install Bifrost as user myclaw
  console.log(`  Installing Bifrost...`);
  const installSuccess = await runCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "su",
    "-l",
    "myclaw",
    "-c",
    "f=$HOME/bifrost && curl -fsSL -o $f https://downloads.getmaxim.ai/bifrost/latest/linux/amd64/bifrost-http && chmod +x $f",
  ]);
  if (!installSuccess) {
    console.error(
      `  Failed to install Bifrost`,
    );
    return;
  }
  console.log(`  Bifrost installed successfully.`);

  // Create openrc service for bifrost
  console.log(`  Creating openrc service for bifrost...`);
  const serviceContent = `#!/sbin/openrc-run

name="bifrost"
description="Bifrost service"

command="/home/myclaw/bifrost"
command_args="--app-dir /home/myclaw --host 0.0.0.0"
command_user="myclaw:myclaw"
command_background="true"
pidfile="/run/bifrost.pid"

output_log="/home/myclaw/bifrost.log"
error_log="/home/myclaw/bifrost.log"

depend() {
	use logger dns
	need net
	after firewall mysql postgresql
}
`;

  const servicePath = `${infraDir}/etc/init.d/bifrost`;
  await ensureDir(`${infraDir}/etc/init.d`);
  await Deno.writeTextFile(servicePath, serviceContent, { mode: 0o755 });

  // Push service file to container
  const pushSuccess = await runCommand([
    "incus",
    "file",
    "push",
    servicePath,
    `${containerName}/etc/init.d/bifrost`,
  ]);
  if (!pushSuccess) {
    console.error(`  Failed to push service file`);
    return;
  }
  console.log(`  Openrc service file created.`);

  // Enable service on boot
  console.log(`  Enabling bifrost service on boot...`);
  const enableSuccess = await runCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "rc-update",
    "add",
    "bifrost",
    "default",
  ]);
  if (!enableSuccess) {
    console.error(`  Failed to enable bifrost service`);
    return;
  }
  console.log(`  Bifrost service enabled on boot.`);

  // Start service
  console.log(`  Starting bifrost service...`);
  const startSuccess = await runCommand([
    "incus",
    "exec",
    containerName,
    "--",
    "rc-service",
    "bifrost",
    "start",
  ]);
  if (!startSuccess) {
    console.error(`  Failed to start bifrost service`);
    return;
  }
  console.log(`  Bifrost service started.`);

  console.log(`  Container '${containerName}' created successfully.`);
}

async function cmdInit(workDir: string, force: boolean): Promise<void> {
  const projectsDir = `${workDir}/projects`;
  const configPath = `${workDir}/config.toml`;
  const secretPath = `${workDir}/secret.toml`;
  await ensureDir(workDir);
  const defaultConfig: MyClawConfig = {
    workDir: workDir,
    projectsDir: projectsDir,
    incus: DEFAULT_INCUS_CONFIG,
    forgejo: DEFAULT_FORGEJO_CONFIG,
  };
  const configCreated = await writeConfigTomlIfMissing(
    configPath,
    defaultConfig,
  );
  let secretCreated = false;
  if (!await pathExists(secretPath)) {
    const defaultSecret: MyClawSecret = {
      forgejoAdminToken: "not-initialized-yet",
    };
    await writeSecretToml(secretPath, defaultSecret);
    secretCreated = true;
  }
  await ensureDir(projectsDir);
  console.log("MyClaw initialized.");
  console.log(`Work dir: ${workDir}`);
  console.log(
    `Config file: ${configPath}${configCreated ? " (created)" : "(exists)"}`,
  );
  console.log(
    `Secret file: ${secretPath}${secretCreated ? " (created)" : "(exists)"}`,
  );

  console.log("\nSetting up Incus resources...");
  const config = await loadConfigToml(workDir);
  const { incus } = config;

  console.log("\n[1/4] Creating run image...");
  await createRunImage(
    incus.baseImage,
    incus.runImageName,
    incus.runPackages,
    APK_REPO_CONF_PATH,
    force,
  );

  console.log("\n[2/4] Creating dev image...");
  await createDevImage(
    incus.runImageName,
    incus.devImageName,
    incus.devPackages,
    force,
  );

  console.log("\n[3/4] Creating Forgejo container...");
  await createForgejoContainer(
    workDir,
    incus.runImageName,
    config.forgejo,
  );

  console.log("\n[4/4] Creating Bifrost container...");
  await createBifrostContainer(
    workDir,
    incus.runImageName,
  );

  console.log("\nMyClaw initialization complete.");
}

async function cmdNew(projectName: string, workDir: string): Promise<void> {
  if (!validateProjectName(projectName)) {
    console.error(
      "Invalid project name. Use letters, digits, '-' or '_', and start with a letter or digit.",
    );
    Deno.exit(1);
  }
  const config = await loadConfigToml(workDir);
  const secret = await loadSecretToml(workDir);
  await ensureDir(config.projectsDir);
  const devHomeDir =
    `${config.projectsDir}/myclaw-dev-${projectName}/home/myclaw`;
  const runHomeDir =
    `${config.projectsDir}/myclaw-run-${projectName}/home/myclaw`;
  await ensureDir(devHomeDir);
  await ensureDir(runHomeDir);

  const repoName = `myclaw-${projectName}`;
  const userName = `myclaw-${projectName}`;
  const devContainerName = `myclaw-dev-${projectName}`;

  console.log(`Project '${projectName}' created.`);
  console.log(`Dev dir: ${devHomeDir}`);
  console.log(`Run dir: ${runHomeDir}`);

  const confHomeMyclawDir = `conf/home/myclaw`;

  if (await pathExists(confHomeMyclawDir)) {
    console.log(`Syncing ${confHomeMyclawDir} to ${devHomeDir}...`);
    try {
      await copy(confHomeMyclawDir, devHomeDir, {
        overwrite: true,
        preserveTimestamps: true,
      });
      console.log(`Synced to devDir.`);
    } catch (error) {
      console.error(`Failed to sync to devDir: ${error}`);
      Deno.exit(1);
    }

    console.log(`Syncing ${confHomeMyclawDir} to ${runHomeDir}...`);
    try {
      await copy(confHomeMyclawDir, runHomeDir, {
        overwrite: true,
        preserveTimestamps: true,
      });
      console.log(`Synced to runDir.`);
    } catch (error) {
      console.error(`Failed to sync to runDir: ${error}`);
      Deno.exit(1);
    }
  } else {
    console.log(
      `Directory ${confHomeMyclawDir} does not exist, skipping sync.`,
    );
  }

  console.log(
    `Creating Forgejo repository '${repoName}' in organization 'MyClaw'...`,
  );
  const forgejoIpOutput = await captureCommand([
    "incus",
    "list",
    "-c4",
    config.forgejo.containerName,
  ]);
  if (!forgejoIpOutput) {
    console.error(
      `Failed to get Forgejo container IPv4`,
    );
    Deno.exit(1);
  }
  const forgejoIp = forgejoIpOutput.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)
    ?.[0];
  if (!forgejoIp) {
    console.error(
      `Could not parse Forgejo container IPv4 from:\n${forgejoIpOutput}`,
    );
    Deno.exit(1);
  }

  const createRepoUrl = `http://${forgejoIp}:3000/api/v1/orgs/MyClaw/repos`;
  const createRepoPayload = {
    name: repoName,
    private: true,
  };
  const createRepoResponse = await fetch(createRepoUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `token ${secret.forgejoAdminToken}`,
    },
    body: JSON.stringify(createRepoPayload),
  });
  if (!createRepoResponse.ok) {
    console.error(
      `Failed to create Forgejo repository '${repoName}': ${createRepoResponse.status} ${await createRepoResponse
        .text()}`,
    );
    Deno.exit(1);
  }
  console.log(`Forgejo repository '${repoName}' created.`);

  console.log(`Creating Forgejo user '${userName}'...`);
  const userPassword = randomToken(16);
  const createUserUrl = `http://${forgejoIp}:3000/api/v1/admin/users`;
  const createUserPayload = {
    username: userName,
    email: `${userName}@noreply.localhost`,
    password: userPassword,
    must_change_password: false,
  };
  const createUserResponse = await fetch(createUserUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `token ${secret.forgejoAdminToken}`,
    },
    body: JSON.stringify(createUserPayload),
  });
  if (!createUserResponse.ok) {
    console.error(
      `Failed to create Forgejo user '${userName}': ${createUserResponse.status} ${await createUserResponse
        .text()}`,
    );
    Deno.exit(1);
  }
  console.log(`Forgejo user '${userName}' created.`);

  const gitCredentialsPath = `${devHomeDir}/.git-credentials`;
  const gitCredentialsContent =
    `http://${userName}:${userPassword}@${config.forgejo.containerName}:3000/MyClaw/${repoName}.git\n`;
  await Deno.writeTextFile(gitCredentialsPath, gitCredentialsContent, {
    mode: 0o600,
  });
  console.log(`Git credentials written to ${gitCredentialsPath}`);

  console.log(
    `Granting developer role for user '${userName}' on repository '${repoName}'...`,
  );
  const addCollaboratorUrl =
    `http://${forgejoIp}:3000/api/v1/repos/MyClaw/${repoName}/collaborators/${userName}`;
  const addCollaboratorPayload = {
    permission: "write",
  };
  const addCollaboratorResponse = await fetch(addCollaboratorUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `token ${secret.forgejoAdminToken}`,
    },
    body: JSON.stringify(addCollaboratorPayload),
  });
  if (!addCollaboratorResponse.ok) {
    console.error(
      `Failed to grant developer role: ${addCollaboratorResponse.status} ${await addCollaboratorResponse
        .text()}`,
    );
    Deno.exit(1);
  }
  console.log(`Developer role granted for user '${userName}'.`);

  console.log(`Creating container '${devContainerName}'...`);
  if (await incusContainerExists(devContainerName)) {
    console.error(`Container '${devContainerName}' already exists.`);
    Deno.exit(1);
  }

  const launchContainerSuccess = await runCommand([
    "incus",
    "launch",
    config.incus.devImageName,
    devContainerName,
  ]);
  if (!launchContainerSuccess) {
    console.error(
      `Failed to launch container ${devContainerName}`,
    );
    Deno.exit(1);
  }
  console.log(`Container '${devContainerName}' launched.`);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log(`Adding mount for devDir to container...`);
  const mountSuccess = await mountHostDir(
    devContainerName,
    "home-myclaw",
    devHomeDir,
    "/home/myclaw",
  );
  if (!mountSuccess) {
    Deno.exit(1);
  }
  console.log(`Mount added successfully.`);

  console.log(`Setting ownership of /home/myclaw in container...`);
  const chownSuccess = await runCommand([
    "incus",
    "exec",
    devContainerName,
    "--",
    "chown",
    "-R",
    "myclaw:myclaw",
    "/home/myclaw",
  ]);
  if (!chownSuccess) {
    console.error(`Failed to set ownership`);
    Deno.exit(1);
  }
  console.log(`Ownership set successfully.`);

  console.log(`Checking out git repository in container...`);
  const gitCheckoutSuccess = await runCommand([
    "incus",
    "exec",
    devContainerName,
    "--",
    "su",
    "-l",
    "myclaw",
    "-c",
    `cd /home/myclaw && git clone http://${config.forgejo.containerName}:3000/MyClaw/${repoName}.git ${projectName}`,
  ]);
  if (!gitCheckoutSuccess) {
    console.error(
      `Failed to checkout git repository`,
    );
    Deno.exit(1);
  }
  console.log(`Git repository checked out to /home/myclaw/${projectName}.`);

  console.log(`Project '${projectName}' setup completed successfully.`);
}

async function main(): Promise<void> {
  const command = new Command()
    .name(APP_NAME)
    .description("MyClaw CLI - Manage your development projects")
    .version("1.0.0")
    .help({
      hints: true,
    })
    .globalOption("--work-dir <path:string>", "Working directory for MyClaw", {
      default: DEFAULT_WORK_DIR,
    });

  command
    .command("init")
    .description("Initialize MyClaw config and workspace directories.")
    .option("-f, --force", "Force rebuild of images even if they already exist")
    .action(async (options) => {
      await cmdInit(options.workDir, options.force ?? false);
    });

  command
    .command("new <project-name:string>")
    .description("Create project directories for development and runtime.")
    .action(async (options, projectName: string) => {
      await cmdNew(projectName, options.workDir);
    });

  command
    .command("help")
    .description("Show help text.")
    .action(() => {
      command.showHelp();
    });

  if (Deno.args.length === 0) {
    command.showHelp();
    return;
  }

  await command.parse(Deno.args);
}

if (import.meta.main) {
  await main();
}
