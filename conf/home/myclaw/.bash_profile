export PATH="$HOME/bin:$HOME/.local/bin:$PATH"

for f in ~/.bash_profile.d/*.sh ~/.bashrc; do
    [ -f "$f" ] && . "$f"
done
