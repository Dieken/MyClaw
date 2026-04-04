for f in ~/.bash_profile.d/*.sh ~/.bashrc; do
    [ -f "$f" ] && . "$f"
done
