import { it, expect } from 'vitest';
import { meetingPlatform } from '@noclue/shared';

it('recognises Google Meet and Microsoft Teams web tabs and nothing else', () => {
  expect(meetingPlatform('https://meet.google.com/abc-defg-hij')).toBe('Google Meet');
  expect(meetingPlatform('https://teams.microsoft.com/light-meetings/launch?p=x&anon=true')).toBe(
    'Microsoft Teams',
  );
  expect(meetingPlatform('https://teams.cloud.microsoft/v2/')).toBe('Microsoft Teams');
  expect(meetingPlatform('https://teams.live.com/meet/123')).toBe('Microsoft Teams');
  expect(meetingPlatform('https://www.teams.microsoft.com/')).toBe('Microsoft Teams');
  expect(meetingPlatform('http://meet.google.com/abc')).toBeUndefined();
  expect(meetingPlatform('https://meet.google.com.evil.example/')).toBeUndefined();
  expect(meetingPlatform('https://www.microsoft.com/teams')).toBeUndefined();
  expect(meetingPlatform('chrome://extensions')).toBeUndefined();
  expect(meetingPlatform(undefined)).toBeUndefined();
  expect(meetingPlatform('not a url')).toBeUndefined();
});
