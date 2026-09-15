# Mail agent

Polls one mailbox over IMAP and writes `data/mail.json`, which the board's
**Mail** tab renders: the newest messages, glowing green while something is
unread, with a × that moves a message to the trash folder.

It never marks anything read — every fetch is `BODY.PEEK`. "Unread" is whatever
the server says; it clears when you read the message in your mail client.

## Setup

Everything is in the board's setup guide, **Email** section: provider (Gmail,
Outlook.com, iCloud, Fastmail, Yahoo, or any IMAP host), address, **app
password**, mailbox. *Try signing in* does a real IMAP login. The values go to
`data/settings.json`; `agent/mail/.env` (see `.env.example`) still works as a
fallback for the same keys.

An app password is not your account password: Gmail makes one at
<https://myaccount.google.com/apppasswords> (2-Step Verification on); Outlook.com
and iCloud have the same under Security.

```powershell
cd agent\mail
py -3 -m pip install -r requirements.txt
run_poll.cmd
```

It prints how many messages it wrote and drops `data/mail.json`; the board
shows the Mail tab on its next tick.

## On a schedule

`scripts\setup.ps1` registers **dayboard-mail** every five minutes while Mail is
turned on, wrapped in `conhost.exe --headless` so no console window appears on
the screen. Nothing to do by hand.

## Notes

- `python-dotenv` is the only third-party dependency; IMAP and email parsing
  are the standard library.
- `AUTHENTICATIONFAILED` on login is almost always the app password (or
  2-Step Verification not being on), not the address.
- The delete queue (`data/mail-queue.json`) is processed *before* the fetch, so
  a message you removed on the board does not reappear on the next poll.
