import { getVoice, configuredGuilds, type GuildVoice } from "@/lib/discord";
import { Freshness } from "@/components/Freshness";
import { VoiceChime } from "@/components/VoiceChime";

/**
 * Who is sitting in voice, so you do not have to run Discord to find out.
 *
 * Stripped to the one fact being asked for. There is one server, its name is not
 * news, and neither is a count of the rooms nobody is in — so no server heading,
 * no channel names, no "3 empty channels · 2 online" footnote. A live room is
 * faces; an empty one is a single sentence.
 *
 * People lay out ACROSS rather than down. That is what keeps this widget a fixed
 * height in the left stack: the roster grows sideways into space the panel
 * already has, and the group is small enough that one wrapped row always holds
 * it. A vertical list would push the column past the screen the moment five
 * people piled into a call.
 */

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (!src) {
    return (
      <span className="dcavatar is-blank" aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  // Discord's widget avatars are already 32px-ish and served from their CDN.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="dcavatar" src={src} alt="" width={28} height={28} loading="lazy" />;
}

function Guild({ guild }: { guild: GuildVoice }) {
  const occupied = guild.channels.filter((c) => c.members.length > 0);

  if (guild.problem) return <p className="empty">{guild.problem}</p>;

  if (occupied.length === 0) {
    // In the same box a live channel would occupy, drawn as an outline. An
    // empty state that is a bare sentence makes the panel change shape every
    // time somebody joins or leaves; a dashed frame holds the place instead, so
    // the column below it never moves.
    return guild.ok ? (
      <div className="dcchannel is-empty">
        <span className="dcchannel-head">
          <span className="dcchannel-glyph" aria-hidden>
            🔇
          </span>
          <span className="dcchannel-state">nobody in</span>
        </span>
        <span className="dcempty-note">The Boys are not online.</span>
      </div>
    ) : null;
  }

  return (
    <>
      {occupied.map((channel) => (
        // Green and pulsing means people are in there and you are not — the one
        // state on this panel worth crossing the room for. Red and still means
        // you are already in the call, so there is nothing to act on.
        <div
          key={channel.id}
          className={`dcchannel ${channel.hasMe ? "is-mine" : "is-calling"}`}
        >
          {/* ONE ROW, not two. The state and the roster used to stack, which
              cost the widget a whole line of height for four words. People go
              to the right of "you're in" instead and the panel is half as tall. */}
          <span className="dcchannel-head">
            <span className="dcchannel-glyph" aria-hidden>
              🔊
            </span>
            <span className="dcchannel-state">{channel.hasMe ? "you're in" : "live"}</span>
            <span className="dcchannel-n">{channel.members.length}</span>
          </span>
          <ul className="dcpeople">
            {channel.members.map((member) => (
              <li key={member.key} className="dcperson">
                <Avatar src={member.avatarUrl} name={member.name} />
                <span className="dcperson-name">{member.name}</span>
                {(member.deafened || member.muted) && (
                  <span
                    className="dcperson-flag"
                    title={member.deafened ? "Deafened" : "Muted"}
                    aria-label={member.deafened ? "Deafened" : "Muted"}
                  >
                    {member.deafened ? "⊘" : "🔇"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export async function DiscordWidget() {
  if (configuredGuilds().length === 0) {
    return (
      <div className="widget">
        <h2 className="stack-title">Discord</h2>

        <div className="widget-scroll">
          <p className="empty">
            Add your server ids in Settings → Discord, and turn the widget on in Server Settings → Widget.
          </p>
        </div>
      </div>
    );
  }

  const { guilds, fetchedAt } = await getVoice();

  // Somebody is in a room you are not — the same condition the green pulse
  // uses, so the bell and the pulse can never disagree. Computed here, across
  // every guild, so the one chime below sits above the roster and stays mounted
  // through the empty state; see VoiceChime for why that placement is the bug.
  const calling = guilds.some(
    (guild) =>
      !guild.problem && guild.channels.some((channel) => channel.members.length > 0 && !channel.hasMe),
  );

  return (
    <div className="widget">
      <VoiceChime calling={calling} enabled />
      <h2 className="stack-title">
        Discord
        <Freshness fetchedAt={fetchedAt} />
      </h2>

      <div className="widget-scroll">
        {guilds.map((guild) => (
          <Guild key={guild.id} guild={guild} />
        ))}
      </div>
    </div>
  );
}
