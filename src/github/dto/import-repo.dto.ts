import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Accepted forms:
 *   https://github.com/{owner}/{repo}
 *   https://github.com/{owner}/{repo}.git
 *   https://www.github.com/{owner}/{repo}/
 *
 * Owner and repo follow GitHub naming rules (alphanumerics, '-', '_', '.').
 */
export const GITHUB_URL_REGEX =
  /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export class ImportRepoDto {
  @ApiProperty({
    description: 'Public GitHub repository URL to import for analysis.',
    example: 'https://github.com/nestjs/typescript-starter',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(GITHUB_URL_REGEX, {
    message:
      'repoUrl must be a valid GitHub repository URL (e.g. https://github.com/owner/repo)',
  })
  repoUrl: string;

  /**
   * Extracts { owner, repo } from a GitHub URL already validated by
   * GITHUB_URL_REGEX. Returns null when the URL does not match.
   */
  static parseGithubUrl(url: string): GithubRepoRef | null {
    const match = GITHUB_URL_REGEX.exec(url.trim());
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }
}
