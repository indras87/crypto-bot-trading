import { LogsRepository } from '../../repository';

export class LogsHttp {
  constructor(private logsRepository: LogsRepository) { }

  async getLogsPageVariables(request: any, response: any): Promise<any> {
    // Check for query params (support both exclude_levels and exclude_levels[])
    let excludeLevels: string[] = request.query.exclude_levels || request.query['exclude_levels[]'] || ['debug'];

    // Ensure it's always an array (Express sends single value as string)
    if (typeof excludeLevels === 'string') {
      excludeLevels = [excludeLevels];
    }

    // Pagination params
    const page = Math.max(1, parseInt(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit) || 50));
    const offset = (page - 1) * limit;

    // Get total count for pagination
    const totalCount = await this.logsRepository.getTotalLogsCount(excludeLevels);
    const totalPages = Math.ceil(totalCount / limit);

    return {
      logs: await this.logsRepository.getLatestLogs(excludeLevels, limit, offset),
      levels: await this.logsRepository.getLevels(),
      form: {
        excludeLevels: excludeLevels
      },
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    };
  }
}
