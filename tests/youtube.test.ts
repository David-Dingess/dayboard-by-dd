import { describe, expect, it } from "vitest";
import { longFormPlaylistId, parseChannelFeed, ago, splitTitle } from "../src/lib/youtube";

// Trimmed from a real playlist feed. Note the feed-level <title> is "Videos" —
// a playlist feed does not name the channel there, only in <author>.
const PLAYLIST_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Videos</title>
 <author><name>The Library of Letourneau</name><uri>https://www.youtube.com/channel/UC_O58Rr2DOskJvs9bArpLkQ</uri></author>
 <entry>
  <id>yt:video:s-WR5ddiyxw</id>
  <yt:videoId>s-WR5ddiyxw</yt:videoId>
  <yt:channelId>UC_O58Rr2DOskJvs9bArpLkQ</yt:channelId>
  <title>The Wet Joker</title>
  <author><name>The Library of Letourneau</name></author>
  <published>2026-09-05T15:22:18+00:00</published>
 </entry>
 <entry>
  <id>yt:video:abc123</id>
  <yt:videoId>abc123</yt:videoId>
  <title>Tom &amp; Jerry &#39;s day out</title>
  <published>2026-09-04T10:00:00+00:00</published>
 </entry>
</feed>`;

describe("long-form playlist ids", () => {
  it("swaps the UC prefix for UULF", () => {
    expect(longFormPlaylistId("UC3tNpTOHsTnkmbwztCs30sA")).toBe("UULF3tNpTOHsTnkmbwztCs30sA");
    expect(longFormPlaylistId("UC_O58Rr2DOskJvs9bArpLkQ")).toBe("UULF_O58Rr2DOskJvs9bArpLkQ");
  });

  it("keeps the id length the channel suffix implies", () => {
    const id = "UCnPWJGK2WaLdycTOCtSciyg";
    expect(longFormPlaylistId(id).slice(4)).toBe(id.slice(2));
  });
});

describe("parsing a feed", () => {
  const videos = parseChannelFeed(PLAYLIST_FEED);

  it("reads every entry", () => {
    expect(videos).toHaveLength(2);
    expect(videos[0].id).toBe("s-WR5ddiyxw");
    expect(videos[0].title).toBe("The Wet Joker");
  });

  it("names the channel from the author, not the playlist title", () => {
    // The bug this guards: a playlist feed's <title> is "Videos", so falling
    // back to it would label every video "Videos".
    expect(videos[0].channel).toBe("The Library of Letourneau");
    expect(videos[1].channel).toBe("The Library of Letourneau");
    expect(videos.map((v) => v.channel)).not.toContain("Videos");
  });

  it("decodes entities in titles", () => {
    expect(videos[1].title).toBe("Tom & Jerry 's day out");
  });

  it("builds watch and thumbnail urls without an API", () => {
    expect(videos[0].url).toBe("https://www.youtube.com/watch?v=s-WR5ddiyxw");
    expect(videos[0].thumbnail).toBe("https://i.ytimg.com/vi/s-WR5ddiyxw/mqdefault.jpg");
  });

  it("returns nothing rather than throwing on junk", () => {
    expect(parseChannelFeed("")).toEqual([]);
    expect(parseChannelFeed("<feed><entry><title>no id</title></entry></feed>")).toEqual([]);
  });
});

describe("relative time", () => {
  const now = Date.parse("2026-09-05T12:00:00Z");
  it("reads as recency", () => {
    expect(ago("2026-09-05T11:30:00Z", now)).toBe("30m ago");
    expect(ago("2026-09-05T07:00:00Z", now)).toBe("5h ago");
    expect(ago("2026-09-02T12:00:00Z", now)).toBe("3d ago");
  });
  it("never goes negative on a clock skew", () => {
    expect(ago("2026-09-05T12:05:00Z", now)).toBe("0m ago");
  });
});

describe("splitting a SomeStreamer title", () => {
  it("leads with the game and drops the joke to a second line", () => {
    expect(splitTitle("a soul for a soul...for a soul (Slay the Spire 2)")).toEqual({
      game: "Slay the Spire 2",
      statement: "a soul for a soul...for a soul",
      ad: false,
    });
  });

  it("takes the LAST brackets, not the first", () => {
    // "it takes (a) two door" has a pair of its own; only the second is a game.
    expect(splitTitle("it takes (a) two door (Wheelmates)")).toEqual({
      game: "Wheelmates",
      statement: "it takes (a) two door",
      ad: false,
    });
  });

  it("strips #ad off the game name but remembers it was there", () => {
    expect(splitTitle("Dangerous is my middle name (Star Wars: Zero Company #ad)")).toEqual({
      game: "Star Wars: Zero Company",
      statement: "Dangerous is my middle name",
      ad: true,
    });
  });

  it("keeps a title that is not this shape whole", () => {
    for (const title of ["No brackets here at all", "trailing (nested (pair))", "(unclosed"]) {
      const parts = splitTitle(title);
      expect(parts.game, title).toBeNull();
      expect(parts.statement, title).toBe(title);
    }
  });

  it("does not call a lone #ad a game", () => {
    expect(splitTitle("Some video (#ad)")).toEqual({
      game: null,
      statement: "Some video (#ad)",
      ad: true,
    });
  });

  it("copes with a game and no statement", () => {
    expect(splitTitle("(Miscellaneous)")).toEqual({
      game: "Miscellaneous",
      statement: "",
      ad: false,
    });
  });
});
