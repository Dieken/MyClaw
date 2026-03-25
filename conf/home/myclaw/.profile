export PATH="$PATH:$HOME/.local/bin:$HOME/bin"

for f in ~/.profile.d/*.sh ~/.bashrc; do
  [ -f "$f" ] && source "$f"
done
