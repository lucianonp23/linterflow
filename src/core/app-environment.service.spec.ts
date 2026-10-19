import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { AppEnvironmentService } from './app-environment.service';

describe('AppEnvironmentService', () => {
  const build = async (appEnv: string | undefined) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppEnvironmentService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'APP_ENV' ? appEnv : undefined) },
        },
      ],
    }).compile();
    return module.get<AppEnvironmentService>(AppEnvironmentService);
  };

  it('enables local-path analysis on the exact string "staging"', async () => {
    const service = await build('staging');

    expect(service.current).toBe('staging');
    expect(service.isProduction()).toBe(false);
    expect(service.isLocalPathAnalysisEnabled()).toBe(true);
    expect(() => service.assertLocalPathAnalysisAllowed()).not.toThrow();
  });

  it('accepts surrounding whitespace and casing, which .env files pick up easily', async () => {
    for (const value of ['  staging  ', 'STAGING', 'Staging']) {
      const service = await build(value);
      expect(service.isLocalPathAnalysisEnabled()).toBe(true);
    }
  });

  it('treats production as production', async () => {
    const service = await build('production');

    expect(service.current).toBe('production');
    expect(service.isProduction()).toBe(true);
    expect(service.isLocalPathAnalysisEnabled()).toBe(false);
  });

  // The whole point of the default: a configuration slip must cost a local run,
  // never the filesystem. Anything that is not exactly "staging" locks the route.
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['misspelt', 'stagging'],
    ['a near miss', 'stage'],
    ['something else entirely', 'development'],
    ['a truthy-looking value', 'true'],
  ])('refuses local-path analysis when APP_ENV is %s', async (_label, value) => {
    const service = await build(value as string | undefined);

    expect(service.isProduction()).toBe(true);
    expect(service.isLocalPathAnalysisEnabled()).toBe(false);
    expect(() => service.assertLocalPathAnalysisAllowed()).toThrow(
      ForbiddenException,
    );
  });

  it('explains what to do instead when it refuses', async () => {
    const service = await build(undefined);

    expect(() => service.assertLocalPathAnalysisAllowed()).toThrow(
      /GitHub repository/i,
    );
  });
});
