import { describe, expect, it } from 'vitest';
import { parseWslListOutput } from '../useWslDiscovery';

describe('parseWslListOutput', () => {
  it('parses a default running distro line with the star marker', () => {
    const output = `NAME                   STATE           VERSION
* Ubuntu-22.04         Running         2
  Debian               Stopped         1`;

    expect(parseWslListOutput(output)).toEqual([
      { name: 'Ubuntu-22.04', state: 'Running', version: 2 },
      { name: 'Debian', state: 'Stopped', version: 1 },
    ]);
  });

  it('parses distro names that contain spaces', () => {
    const output = `NAME                   STATE           VERSION
  docker desktop-data  Running         2`;

    expect(parseWslListOutput(output)).toEqual([
      { name: 'docker desktop-data', state: 'Running', version: 2 },
    ]);
  });
});
