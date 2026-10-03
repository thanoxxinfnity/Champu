# Sideload signing key for the Chomu games

`sideload.keystore` signs the Chomu Horizon and Chomu Dead APKs that CI publishes.
It exists so that **every build is signed by the same key**: Android only installs a new
APK over an old one if both carry the same signature. CI used to make a fresh key on every
run, so each new build was refused with "App not installed" on any phone that had the old one.

The password is `chomugames` and the key is public on purpose. It protects nothing but the
"is this an update of the same game" check for two free sideloaded games. It is **not** the
Chomugiri app key (that one is never in git). If it is ever misused, make a new one — players
then uninstall once.

CI also sets `version/code` from the run number so each build counts as an upgrade.
