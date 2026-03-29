#!/usr/bin/env bash
#
# MyClaw - A local development environment for LLM agents and applications
#
# Dependencies: bash coreutils docker git rsync
#
# Access files: $HOME/myclaw-work/
#
# Author: Dieken at github.com

set -euo pipefail
shopt -s failglob

main() {
    # The name of the project, used as a prefix for work directory, images, containers and network
    : "${MYCLAW:="myclaw"}"
    : "${WORK_DIR:="$HOME/$MYCLAW-work"}"
    : "${MYCLAW_USER:="myclaw"}"
    : "${MYCLAW_ORG:="MyClaw"}"
    : "${DOCKER:=docker}"
    : "${DOCKER_BUILD_ARGS:=}"
    : "${PORT_BASE:="9000"}"

    RUN_IMAGE_NAME="$MYCLAW-run"
    DEV_IMAGE_NAME="$MYCLAW-dev"
    INFRA_IMAGE_PREFIX="$MYCLAW-infra-"

    RUN_CONTAINER_PREFIX="$RUN_IMAGE_NAME-"
    DEV_CONTAINER_PREFIX="$DEV_IMAGE_NAME-"
    INFRA_CONTAINER_PREFIX="$INFRA_IMAGE_PREFIX"

    NETWORK_DOMAIN="${MYCLAW}.local"

    FORGEJO_IMAGE_NAME="${INFRA_IMAGE_PREFIX}forgejo"
    FORGEJO_CONTAINER_NAME="${INFRA_CONTAINER_PREFIX}forgejo"
    FORGEJO_PORT="$PORT_BASE"
    FORGEJO_HOSTNAME="git"

    BIFROST_IMAGE_NAME="${INFRA_IMAGE_PREFIX}bifrost"
    BIFROST_CONTAINER_NAME="${INFRA_CONTAINER_PREFIX}bifrost"
    BIFROST_PORT="$((PORT_BASE + 1))"
    BIFROST_HOSTNAME="llm-proxy"

    BIN_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
    CONF_DIR="$BIN_DIR/conf"
    [ -d "$CONF_DIR" ] || { echo "ERROR: configuration directory '$CONF_DIR' not found" >&2; exit 1; }

    if [ $# -eq 0 ]; then
        cmd=
    else
        cmd="$1"
        shift
    fi

    case "$cmd" in
        init)
            cmd_init "$@"
            ;;
        new)
            cmd_new "$@"
            ;;
        dev)
            cmd_dev "$@"
            ;;
        run)
            cmd_run "$@"
            ;;
        -h|--help|help|"")
            usage
            ;;
        *)
            echo "ERROR: unknown command '$cmd'" >&2
            usage >&2
            exit 1
            ;;
    esac
}

build_image() {
    local name="$1" dockerfile="$2"

    echo "Building container image '$name' from '$dockerfile'..."
    "$DOCKER" build --build-arg user="$MYCLAW_USER" --build-arg runbase="$RUN_IMAGE_NAME" \
        $DOCKER_BUILD_ARGS -t "$name" -f "$dockerfile" "$BIN_DIR"
    echo
}

create_network() {
    if "$DOCKER" network inspect "$NETWORK_DOMAIN" >/dev/null 2>&1; then
        echo "Network '$NETWORK_DOMAIN' already exists, skipping creation."
    else
        "$DOCKER" network create "$NETWORK_DOMAIN" >/dev/null
        echo "Network '$NETWORK_DOMAIN' created successfully."
    fi

    echo
}

create_container() {
    local name="$1" image="$2" hostname="$3" extra="$4"
    shift 4

    if "$DOCKER" start "$name" >/dev/null 2>&1; then
        echo "Container '$name' already exists, skipping creation."
    else
        "$DOCKER" run -dt -u "$MYCLAW_USER" -w "/home/$MYCLAW_USER" $extra --init --restart=unless-stopped \
            --name "$name" --hostname "$hostname" --domainname "$NETWORK_DOMAIN" --network "$NETWORK_DOMAIN" \
            "$image" "$@" >/dev/null
        echo "Container '$name' created successfully."
    fi
}

create_forgejo_container() {
    local home_dir="$WORK_DIR/infra/$FORGEJO_CONTAINER_NAME/home/$MYCLAW_USER"
    local forgejo_home="/home/$MYCLAW_USER/forgejo"
    local forgejo_config="$forgejo_home/app.ini"

    mkdir -p "$home_dir"

    create_container "$FORGEJO_CONTAINER_NAME" "$FORGEJO_IMAGE_NAME" "$FORGEJO_HOSTNAME" \
        "--expose $FORGEJO_PORT -p $FORGEJO_PORT:$FORGEJO_PORT -v $home_dir:/home/$MYCLAW_USER" \
        forgejo web --work-path "$forgejo_home" --config "$forgejo_config" --port "$FORGEJO_PORT"

    if "$DOCKER" exec -u "$MYCLAW_USER" "$FORGEJO_CONTAINER_NAME" grep -Eq '^\s*INSTALL_LOCK\s*=\s*true' "$forgejo_config" >/dev/null 2>&1; then
        echo "Forgejo already setup in container '$FORGEJO_CONTAINER_NAME', skipping setup."
    else
        "$DOCKER" exec -u "$MYCLAW_USER" "$FORGEJO_CONTAINER_NAME" bash -c "
            set -euo pipefail
            umask 0077

            while ! curl -4s 'http://localhost:$FORGEJO_PORT/api/v1/version' >/dev/null; do
                echo '    Waiting for Forgejo to start...'
                sleep 1
            done

            username=administrator
            password=\"\$(pwgen -cnsB 20 1)\"
            host='$FORGEJO_HOSTNAME.$NETWORK_DOMAIN'

            echo '    Setting up Forgejo with administrator credential and configuration...'
            curl -4fs 'http://localhost:$FORGEJO_PORT' -H 'Content-Type: application/x-www-form-urlencoded' \
                --data-raw \"db_type=sqlite3&db_host=&db_user=&db_passwd=&db_name=&ssl_mode=disable&db_schema=&db_path=%2Fhome%2F$MYCLAW_USER%2Fforgejo%2Fdata%2Fforgejo.db&app_name=$MYCLAW_ORG&app_slogan=Beyond+coding.+We+Forge.&repo_root_path=%2Fhome%2F$MYCLAW_USER%2Fforgejo%2Fdata%2Fforgejo-repositories&lfs_root_path=%2Fhome%2F$MYCLAW_USER%2Fforgejo%2Fdata%2Flfs&run_user=$MYCLAW_USER&domain=\$host&ssh_port=22&http_port=$FORGEJO_PORT&app_url=http%3A%2F%2F\$host%3A$FORGEJO_PORT%2F&log_root_path=%2Fhome%2F$MYCLAW_USER%2Fforgejo%2Flog&disable_registration=on&enable_update_checker=on&smtp_addr=&smtp_port=&smtp_from=&smtp_user=&smtp_passwd=&offline_mode=on&disable_gravatar=on&enable_open_id_sign_in=on&enable_open_id_sign_up=on&require_sign_in_view=on&default_keep_email_private=on&default_allow_create_organization=on&default_enable_timetracking=on&no_reply_address=noreply.localhost&password_algorithm=pbkdf2_hi&admin_name=\$username&admin_email=\$username%40noreply.localhost&admin_passwd=\$password&admin_confirm_passwd=\$password\" >/dev/null

            {
                echo '## This file is generated by myclaw.sh, you can delete it after reading the admin credential.'
                echo \"FORGEJO_ADMIN_USERNAME='\$username'\"
                echo \"FORGEJO_ADMIN_PASSWORD='\$password'\"
                echo
            } >> forgejo_admin_credential

            auth=\$(echo -n \"\$username:\$password\" | base64)
            while ! curl -4fs \"http://localhost:$FORGEJO_PORT/api/v1/users/\$username/tokens?limit=1\" -H \"Authorization: Basic \$auth\" >/dev/null; do
                echo '    Waiting for Forgejo to apply configuration...'
                sleep 1
            done

            echo '    Generating admin access token for API...'
            token=\$(curl -4fs \"http://localhost:$FORGEJO_PORT/api/v1/users/\$username/tokens\" -H \"Authorization: Basic \$auth\" \
                -H 'Content-Type: application/json' --data-raw '{\"name\": \"forgejo-admin-token\", \"scopes\": [\"write:admin\", \"read:misc\", \"read:user\", \"write:organization\", \"write:repository\"]}' |
                jq -r '.sha1')
            {
                echo '## This file is generated by myclaw.sh, DO NOT delete it!!!'
                echo \"FORGEJO_ADMIN_TOKEN='\$token'\"
            } >> forgejo_admin_token

            echo \"    Creating an organization named $MYCLAW_ORG with limited visibility...\"
            curl -4fs 'http://localhost:$FORGEJO_PORT/api/v1/orgs' -H \"Authorization: token \$token\" -H 'Content-Type: application/json' --data-raw '{\"username\": \"$MYCLAW_ORG\", \"visibility\": \"limited\", \"repo_admin_change_team_access\": true}' >/dev/null
        "

        echo "Forgejo setup successfully in container '$FORGEJO_CONTAINER_NAME'."
        echo
        echo '!!! Notice: Forejo administrator credential and access token are saved to these files:'
        echo "!!!    $home_dir/forgejo_admin_credential"
        echo "!!!    $home_dir/forgejo_admin_token"
        echo
    fi

    echo "Forgejo is listening on http://localhost:$FORGEJO_PORT"
    echo
}

create_git_repository() {
    local git_repo_name="$1"

    "$DOCKER" exec -u "$MYCLAW_USER" "$FORGEJO_CONTAINER_NAME" bash -c "
        set -euo pipefail
        . forgejo_admin_token

        if curl -4fs 'http://localhost:$FORGEJO_PORT/api/v1/repos/$MYCLAW_ORG/$git_repo_name' -H \"Authorization: token \$FORGEJO_ADMIN_TOKEN\" >/dev/null; then
            echo 'Git repository \"$MYCLAW_ORG/$git_repo_name\" already exists in Forgejo, skipping creation.'
        else
            echo 'Creating git repository '$git_repo_name' in Forgejo...'
            curl -4fs 'http://localhost:$FORGEJO_PORT/api/v1/orgs/$MYCLAW_ORG/repos' \
                -H \"Authorization: token \$FORGEJO_ADMIN_TOKEN\" -H 'Content-Type: application/json' \
                --data-raw '{\"name\": \"$git_repo_name\", \"private\": true}' >/dev/null

            for b in main master 'release/**'; do
                echo \"    Protecting git branches \$b ...\"
                curl -4fs 'http://localhost:$FORGEJO_PORT/api/v1/repos/$MYCLAW_ORG/$git_repo_name/branch_protections' \
                    -H \"Authorization: token \$FORGEJO_ADMIN_TOKEN\" -H 'Content-Type: application/json' \
                    --data-raw \"{\\\"rule_name\\\": \\\"\$b\\\", \\\"enable_push\\\": true}\" >/dev/null
            done

            for t in 'v*' '[0-9]*' 'release-*'; do
                echo \"    Protecting git tags \$t ...\"
                curl -4fs 'http://localhost:$FORGEJO_PORT/api/v1/repos/$MYCLAW_ORG/$git_repo_name/tag_protections' \
                    -H \"Authorization: token \$FORGEJO_ADMIN_TOKEN\" -H 'Content-Type: application/json' \
                    --data-raw \"{\\\"name_pattern\\\": \\\"\$t\\\", \\\"whitelist_teams\\\": [\\\"Owners\\\"]}\" >/dev/null
            done

            echo 'Git repository \"$MYCLAW_ORG/$git_repo_name\" created successfully.'
        fi
    "
}

create_git_user() {
    local git_user_name="$1" git_repo_name="$2" dev_home_dir="$3" git_user_password

    if "$DOCKER" exec -u "$MYCLAW_USER" "$FORGEJO_CONTAINER_NAME" bash -c "
            set -euo pipefail
            . forgejo_admin_token
            curl -4fs 'http://localhost:$FORGEJO_PORT/api/v1/users/$git_user_name' -H \"Authorization: token \$FORGEJO_ADMIN_TOKEN\" >/dev/null"; then
        echo "Git user '$git_user_name' already exists in Forgejo, skipping creation."
    else
        echo "Creating git user '$git_user_name' in Forgejo..."

        git_user_password=$("$DOCKER" exec -u "$MYCLAW_USER" "$FORGEJO_CONTAINER_NAME" bash -c "
            set -euo pipefail
            . forgejo_admin_token
            password=\"\$(pwgen -cnsB 20 1)\"
            curl -4fs 'http://localhost:$FORGEJO_PORT/api/v1/admin/users' \
                -H \"Authorization: token \$FORGEJO_ADMIN_TOKEN\" -H 'Content-Type: application/json' \
                --data-raw \"{\\\"username\\\": \\\"$git_user_name\\\", \\\"email\\\": \\\"$git_user_name@noreply.localhost\\\", \\\"password\\\": \\\"\$password\\\", \\\"must_change_password\\\": false}\" >/dev/null
            echo \"\$password\"
            ")

        echo "Git user '$git_user_name' created successfully."

        echo "Writing git credential for user '$git_user_name' to '$dev_home_dir/.git-credentials'..."
        echo "http://$git_user_name:$git_user_password@$FORGEJO_HOSTNAME.$NETWORK_DOMAIN:$FORGEJO_PORT/$MYCLAW_ORG/$git_repo_name.git" > "$dev_home_dir/.git-credentials"
        chmod 0600 "$dev_home_dir/.git-credentials"
    fi
}

grant_git_repository_write() {
    local git_user_name="$1" git_repo_name="$2"

    "$DOCKER" exec -u "$MYCLAW_USER" "$FORGEJO_CONTAINER_NAME" bash -c "
        set -euo pipefail
        . forgejo_admin_token
        if curl -4fs 'http://localhost:$FORGEJO_PORT/api/v1/repos/$MYCLAW_ORG/$git_repo_name/collaborators/$git_user_name' -H \"Authorization: token \$FORGEJO_ADMIN_TOKEN\" >/dev/null; then
            echo \"User '$git_user_name' is already a collaborator of repository '$MYCLAW_ORG/$git_repo_name', skipping adding collaborator.\"
        else
            echo \"Adding user '$git_user_name' as a collaborator to repository '$MYCLAW_ORG/$git_repo_name' in Forgejo...\"
            curl -4fs -XPUT 'http://localhost:$FORGEJO_PORT/api/v1/repos/$MYCLAW_ORG/$git_repo_name/collaborators/$git_user_name' \
                -H 'Content-Type: application/json' -H \"Authorization: token \$FORGEJO_ADMIN_TOKEN\" \
                --data-raw '{\"permission\": \"write\"}' >/dev/null &&
            echo \"User '$git_user_name' added as a collaborator to repository '$MYCLAW_ORG/$git_repo_name' successfully.\"
        fi
    "
}

create_bifrost_container() {
    local home_dir="$WORK_DIR/infra/$BIFROST_CONTAINER_NAME/home/$MYCLAW_USER"
    local bifrost_home="/home/$MYCLAW_USER/bifrost"

    mkdir -p "$home_dir"

    create_container "$BIFROST_CONTAINER_NAME" "$BIFROST_IMAGE_NAME" "$BIFROST_HOSTNAME" \
        "--expose $BIFROST_PORT -p $BIFROST_PORT:$BIFROST_PORT -v $home_dir:/home/$MYCLAW_USER" \
        bifrost --app-dir "$bifrost_home" --host '' --port "$BIFROST_PORT"

    if "$DOCKER" exec -u "$MYCLAW_USER" "$BIFROST_CONTAINER_NAME" test -f bifrost_admin_credential >/dev/null 2>&1; then
        echo "Bifrost already setup in container '$BIFROST_CONTAINER_NAME', skipping setup."
    else
        "$DOCKER" exec -u "$MYCLAW_USER" "$BIFROST_CONTAINER_NAME" bash -c "
            set -euo pipefail
            umask 0077

            while ! curl -4s 'http://localhost:$BIFROST_PORT/api/version' >/dev/null; do
                echo '    Waiting for Bifrost to start...'
                sleep 1
            done

            username=administrator
            password=\"\$(pwgen -cnsB 20 1)\"

            echo '    Setting up Bifrost with administrator credential and configuration...'
            curl -XPUT -4fs 'http://localhost:$BIFROST_PORT/api/config' -H 'Content-Type: application/json' \
                --data-raw \"{\\\"auth_config\\\":{\\\"admin_password\\\":{\\\"value\\\":\\\"\$password\\\",\\\"env_var\\\":\\\"\\\",\\\"from_env\\\":false},\\\"admin_username\\\":{\\\"value\\\":\\\"\$username\\\",\\\"env_var\\\":\\\"\\\",\\\"from_env\\\":false},\\\"disable_auth_on_inference\\\":true,\\\"is_enabled\\\":true},\\\"client_config\\\":{\\\"drop_excess_requests\\\":false,\\\"initial_pool_size\\\":5000,\\\"prometheus_labels\\\":[],\\\"enable_logging\\\":true,\\\"disable_content_logging\\\":false,\\\"disable_db_pings_in_health\\\":false,\\\"log_retention_days\\\":365,\\\"enforce_auth_on_inference\\\":true,\\\"allow_direct_keys\\\":false,\\\"allowed_origins\\\":[\\\"*\\\"],\\\"max_request_body_size_mb\\\":100,\\\"enable_litellm_fallbacks\\\":false,\\\"mcp_agent_depth\\\":10,\\\"mcp_tool_execution_timeout\\\":30,\\\"mcp_code_mode_binding_level\\\":\\\"server\\\",\\\"mcp_tool_sync_interval\\\":10,\\\"async_job_result_ttl\\\":3600,\\\"hide_deleted_virtual_keys_in_filters\\\":false},\\\"framework_config\\\":{\\\"id\\\":1,\\\"pricing_url\\\":\\\"https://getbifrost.ai/datasheet\\\",\\\"pricing_sync_interval\\\":86400},\\\"is_cache_connected\\\":false,\\\"is_db_connected\\\":true,\\\"is_logs_connected\\\":true,\\\"restart_required\\\":{\\\"required\\\":false}}\" >/dev/null

            {
                echo '## This file is generated by myclaw.sh, DO NOT delete it!!!'
                echo \"BIFROST_ADMIN_USERNAME='\$username'\"
                echo \"BIFROST_ADMIN_PASSWORD='\$password'\"
                echo
            } >> bifrost_admin_credential
        "

        echo "Bifrost setup successfully in container '$BIFROST_CONTAINER_NAME'."
        echo
        echo '!!! Notice: Bifrost administrator credential is saved to this file:'
        echo "!!!    $home_dir/bifrost_admin_credential"
        echo
    fi

    echo "Bifrost is listening on http://localhost:$BIFROST_PORT"
    echo
}

create_bifrost_virtual_key() {
    local name="$1"

    key=$("$DOCKER" exec -u "$MYCLAW_USER" "$BIFROST_CONTAINER_NAME" bash -c "
        set -euo pipefail

        . bifrost_admin_credential
        auth=\$(echo -n \"\$BIFROST_ADMIN_USERNAME:\$BIFROST_ADMIN_PASSWORD\" | base64)

        curl -4fs 'http://localhost:$BIFROST_PORT/api/governance/virtual-keys?limit=100&search=$name' \
            -H \"Authorization: Basic \$auth\" | jq -r '.virtual_keys[] | select(.name == \"$name\") | .value'"
        )

    if [ "$key" ]; then
        echo "$key"
    else
        "$DOCKER" exec -u "$MYCLAW_USER" "$BIFROST_CONTAINER_NAME" bash -c "
            set -euo pipefail

            . bifrost_admin_credential
            auth=\$(echo -n \"\$BIFROST_ADMIN_USERNAME:\$BIFROST_ADMIN_PASSWORD\" | base64)

            curl -4fs 'http://localhost:$BIFROST_PORT/api/governance/virtual-keys' \
                -H \"Authorization: Basic \$auth\" -H 'Content-Type: application/json' \
                --data-raw '{\"name\": \"$name\"}' | jq -r '.virtual_key.value'
        "
    fi
}

save_bifrost_virtual_key() {
    local path="$1" name="$2" api_key

    [ -f "$path" ] || {
        echo "Adding Bifrost environment variables to $path..."

        api_key=$(create_bifrost_virtual_key "$name")
        mkdir -p "$(dirname "$path")"
        {
            echo "export OPENAI_BASE_URL='http://$BIFROST_HOSTNAME.$NETWORK_DOMAIN:$BIFROST_PORT/openai'"
            echo "export OPENAI_API_KEY='$api_key'"
            echo "export ANTHROPIC_BASE_URL='http://$BIFROST_HOSTNAME.$NETWORK_DOMAIN:$BIFROST_PORT/anthropic'"
            echo "export ANTHROPIC_API_KEY='$api_key'"
        } > "$path"

        chmod 0600 "$path"
    }
}

initialize_home_dir() {
    local home_dir="$1"

    echo "Initialize '$home_dir' with '$CONF_DIR/home/$MYCLAW_USER'..."
    mkdir -p "$home_dir"
    rsync -abcr --backup-dir=../backup --suffix=".bak-$(date +%Y%m%d-%H%M%S)" "$CONF_DIR/home/$MYCLAW_USER/" "$home_dir"
}

validate_project_name() {
    local project=""

    [ $# -eq 0 ] || { project="$1"; }
    [ "$project" ] || { echo "ERROR: project name not provided!" >&2; exit 1; }

    [[ "$project" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]] || {
        echo "ERROR: invalid project name '$project'. It must start with a letter and can only contain letters, digits, underscores." >&2
        exit 1
    }

    echo "$project"
}

cmd_init() {
    build_image "$RUN_IMAGE_NAME" "$BIN_DIR/Dockerfile.run"
    build_image "$DEV_IMAGE_NAME" "$BIN_DIR/Dockerfile.dev"
    build_image "$FORGEJO_IMAGE_NAME" "$BIN_DIR/Dockerfile.forgejo"
    build_image "$BIFROST_IMAGE_NAME" "$BIN_DIR/Dockerfile.bifrost"

    create_network
    create_forgejo_container
    create_bifrost_container
}

cmd_new() {
    local project run_home_dir dev_home_dir dev_container_name git_repo_name git_user_name

    # (1) valdate project name
    project=$(validate_project_name "$@")
    shift

    # (2) initialize home directories for run and dev containers
    run_home_dir="$WORK_DIR/projects/$RUN_CONTAINER_PREFIX$project/home/$MYCLAW_USER"
    dev_home_dir="$WORK_DIR/projects/$DEV_CONTAINER_PREFIX$project/home/$MYCLAW_USER"

    initialize_home_dir "$run_home_dir"
    initialize_home_dir "$dev_home_dir"

    run_container_name="$RUN_CONTAINER_PREFIX$project"
    dev_container_name="$DEV_CONTAINER_PREFIX$project"
    git_repo_name="$MYCLAW-$project"
    git_user_name="$MYCLAW-$project"

    # (3) create a git repository for the project in Forgejo
    create_git_repository "$git_repo_name"

    # (4) create a git user for the project in Forgejo and save the credential to the development home directory
    create_git_user "$git_user_name" "$git_repo_name" "$dev_home_dir"

    # (5) add the git user as a collaborator to the repository
    grant_git_repository_write "$git_user_name" "$git_repo_name"

    # (6) create a development container for the project
    create_container "$dev_container_name" "$DEV_IMAGE_NAME" "$dev_container_name" \
        "-v $dev_home_dir:/home/$MYCLAW_USER" sleep infinity

    # (7) Clone the git repository to the container
    echo "Cloning git repository '$MYCLAW_ORG/$git_repo_name' to development container '$dev_container_name'..."
    "$DOCKER" exec -u "$MYCLAW_USER" "$dev_container_name" bash -c "
        [ -d '$project' ] || git clone 'http://$FORGEJO_HOSTNAME.$NETWORK_DOMAIN:$FORGEJO_PORT/$MYCLAW_ORG/$git_repo_name.git' '$project'"

    # (8) Create Bifrost virtual keys for the project and save them to the home directories of run and dev containers
    save_bifrost_virtual_key "$dev_home_dir/.bashrc.d/00-bifrost.sh" "$dev_container_name"
    save_bifrost_virtual_key "$run_home_dir/.bashrc.d/00-bifrost.sh" "$run_container_name"

    echo "Project '$project' created successfully. You can enter the development container with 'myclaw.sh dev $project'."
}

cmd_dev() {
    local project

    project=$(validate_project_name "$@")
    shift

    echo "Entering development container for project '$project'..."
    if [ $# -eq 0 ]; then
        exec "$DOCKER" exec -u "$MYCLAW_USER" -it "$DEV_CONTAINER_PREFIX$project" bash -l
    else
        exec "$DOCKER" exec -u "$MYCLAW_USER" -it "$DEV_CONTAINER_PREFIX$project" "$@"
    fi
}

cmd_run() {
    local project run_container_name run_home_dir

    project=$(validate_project_name "$@")
    shift

    run_container_name="$RUN_CONTAINER_PREFIX$project"
    run_home_dir="$WORK_DIR/projects/$RUN_CONTAINER_PREFIX$project/home/$MYCLAW_USER"

    create_container "$run_container_name" "$RUN_IMAGE_NAME" "$run_container_name" \
        "-v $run_home_dir:/home/$MYCLAW_USER" sleep infinity

    echo "Entering runtime container for project '$project'..."
    if [ $# -eq 0 ]; then
        exec "$DOCKER" exec -u "$MYCLAW_USER" -it "$RUN_CONTAINER_PREFIX$project" bash -l
    else
        exec "$DOCKER" exec -u "$MYCLAW_USER" -it "$RUN_CONTAINER_PREFIX$project" "$@"
    fi
}

usage() {
    echo "Usage: $0 <command> [args]"
    echo
    echo "Commands:"
    echo "  init            Initialize MyClaw infrastructure"
    echo "  new <project>   Create a new project"
    echo "  dev <project>   Enter the development container for a project"
    echo "  run <project>   Enter the runtime container for a project"
    echo "  help            Show this help message"
    echo
}

main "$@"

# vi: set ts=4 sw=4 sts=4 et:
