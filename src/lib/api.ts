import { notif } from './notifications';
import type { ApiChannel, ApiChannelsResponse, ChannelsResponse, ApiClip, ApiClipsResponse, ClipsResponse, SortType, ClipObject } from '$lib/types';

const API_ENDPOINT = new URL('https://kick.com/api/');

function cleanChannelQuery(channel: string): string {
  return channel
    .replace(/[^a-zA-Z0-9_ -]/g, '')
    .replace(/ +/g, ' ')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .toLowerCase()
    .trim();
}

function cleanClipQuery(cursor: string): string {
  return cursor.replace(/[^a-zA-Z0-9_]/g, '');
}

export async function searchChannels(query: string): Promise<ChannelsResponse> {
  const validQuery = cleanChannelQuery(query);
  let result: ChannelsResponse = [];

  if (validQuery.length < 3) return result;

  let apiRes: ApiChannelsResponse = {};
  const requestUrl = new URL('search', API_ENDPOINT);
  requestUrl.searchParams.append('searched_word', validQuery);

  console.debug('fetching', requestUrl, '...');

  try {
    const response = await fetch(requestUrl, {
      headers: { Accept: 'application/json' },
      method: 'GET',
    });

    console.debug(`fetch ended (${response.status}, ${response.statusText})`);

    if (response.ok) {
      apiRes = await response.json();
    } else {
      console.error(`Network response was not ok (${response.status})`);
    }
  } catch (error) {
    notif.error('Error searching for channels');
    console.error(`Error fetching channels: ${error}`);
  }

  if (apiRes.channels) {
    result = apiRes.channels.map((channel: ApiChannel) => {
      return {
        slug: channel.slug ?? 'slug',
        followers: channel.followersCount ?? 0,
        name: channel.user?.username ?? 'name',
        avatar: channel.user?.profilePic ?? '',
        verified: !!channel.verified,
      };
    });
  }
  return result;
}

export async function searchClips(channel: string, cursor: string, sort: SortType, startDate?: Date, endDate?: Date): Promise<ClipsResponse> {
  const validChannel = cleanChannelQuery(channel);
  const validCursor = cleanClipQuery(cursor);
  let result: ClipsResponse = { clips: [], nextCursor: '' };

  if (validChannel.length < 3) return result;

  if (!startDate || !endDate) {
    return fetchSinglePage(validChannel, validCursor, sort);
  }

  const startUTC = new Date(startDate);
  startUTC.setHours(0, 0, 0, 0);
  const endUTC = new Date(endDate);
  endUTC.setHours(23, 59, 59, 999);

  let allClips: ClipObject[] = [];
  let currentCursor = validCursor;
  let reachedStartDate = false;

  while (!reachedStartDate) {
    const firstPage = await fetchPage(validChannel, currentCursor, sort);

    if (!firstPage.clips || firstPage.clips.length === 0) break;
    const mappedFirst = mapClips(firstPage.clips);
    allClips = [...allClips, ...mappedFirst];
    currentCursor = firstPage.nextCursor ?? '';
    const oldestClip = mappedFirst[mappedFirst.length - 1];

    if (oldestClip.date < startUTC || !currentCursor) {
      reachedStartDate = true;
    }
  }

  result.clips = allClips.filter((clip) => clip.date >= startUTC && clip.date <= endUTC);
  result.nextCursor = currentCursor;

  return result;
}

async function fetchPage(channel: string, validCursor: string, sort: SortType): Promise<ApiClipsResponse> {
  const requestUrl = new URL(`v2/channels/${channel}/clips`, API_ENDPOINT);
  requestUrl.searchParams.append('sort', sort);

  if (validCursor) {
    requestUrl.searchParams.append('cursor', validCursor);
  }

  try {
    const response = await fetch(requestUrl, {
      headers: { Accept: 'application/json' },
      method: 'GET',
    });

    console.debug(`fetch ended (${response.status}, ${response.statusText})`);

    if (response.ok) {
      return await response.json();
    } else {
      console.error(`Network response was not ok (${response.status})`);
    }
  } catch (error) {
    console.error(`Error fetching clips: ${error}`);
  }
  return {};
}

async function fetchSinglePage(channel: string, cursor: string, sort: SortType): Promise<ClipsResponse> {
  const apiRes = await fetchPage(channel, cursor, sort);
  const clips = apiRes.clips ? mapClips(apiRes.clips) : [];
  return { clips, nextCursor: apiRes.nextCursor ?? '' };
}

function mapClips(clips: ApiClip[]): ClipObject[] {
  return clips.map((clip: ApiClip) => {
    let validDate: Date;

    try {
      validDate = new Date(clip.created_at ?? '');
      if (isNaN(validDate.getTime())) throw new Error('Invalid');
    } catch {
      validDate = new Date();
    }

    return {
      id: clip.id ?? 'unknown',
      title: clip.title ?? 'Untitled',
      video: clip.clip_url ?? '',
      thumbnail: clip.thumbnail_url ?? '',
      views: clip.views ?? 0,
      duration: clip.duration ?? 0,
      date: validDate,
      creator: clip.creator?.username ?? '',
      channel: clip.channel?.slug ?? '',
    };
  });
}
