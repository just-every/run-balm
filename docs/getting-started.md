Balm runs on your own computer: your clinic's records stay in a database in your copy of Balm.

> Balm is new. Keep real patient data out of it until your clinic has completed its own privacy review.

## Start Balm

Install Git, then run one line in a terminal to install the `rer` launcher, get Balm and start it:

```sh
npx -y @runeditrun/rer dev just-every/run-balm
```

No Node? `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-balm` does the same and brings its own Node; it changes no shell settings, so if it prints an `export PATH=…` line, run that line to use `rer` again later. To set Balm up without starting it, use `setup` in place of `dev`.

The first start can take several minutes while `rer dev` installs everything and prepares the local database. If it is interrupted, run it again.

## Sign in as the owner

When Balm is ready, the terminal prints:

- `RER_READY http://127.0.0.1:<port>`: your Balm's address.
- `RER_OPEN …`: a private link that opens Balm signed in as the owner. Open it on this computer. **Staff security** first asks you to set up an authenticator and enter its code; save the one-use recovery codes privately, then select **Open Balm** and **Finish setup**. Balm then asks for your clinic's time zone, filled in from your browser (US zones first); check it and select **Save and open the schedule**. Treat the link like a password.
- `RER_SITE http://127.0.0.1:<port>`: this website, served locally.

To use your own email as the owner, run `npx -y @runeditrun/rer setup just-every/run-balm --owner-email you@example.com` in place of the one line, then `cd run-balm && rer dev`.

## Start and stop it later

```sh
cd run-balm && rer dev
```

Stop it with `rer dev --stop` or Ctrl-C. If the saved port is taken, pick another with `rer dev --port 8899`. Never expose the development server to the internet.

Development and demo mail is silently suppressed; no messages are stored or shown.

## Next

[Set up your clinic](/docs/set-up-your-clinic): the four steps the **Schedule** page lists under **Finish setting up**.
