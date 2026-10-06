import { describe, it, expect } from 'vitest';
import type { ContentBundle } from '@prod/engine';
import { loadContent } from '../src/index';
import { playCampaign } from './playbook';

const content: ContentBundle = loadContent();

describe('campaign reachability', () => {
  it('the whole campaign can be played m001 → m100 through player actions', () => {
    const { play, completed } = playCampaign(content);
    expect(completed.length).toBe(content.missionIndex.length);
    expect(play.s.campaign.finished).toBe(true);
    expect(completed[0]).toBe('m001');
    expect(completed[completed.length - 1]).toBe('m100');
  }, 180_000);
});
