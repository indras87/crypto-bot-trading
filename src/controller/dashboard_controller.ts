import { BaseController, TemplateHelpers } from './base_controller';
import { Ta } from '../modules/ta';
import { DashboardConfigService } from '../modules/system/dashboard_config_service';
import { AiStatusService } from '../ai/ai_status_service';
import express from 'express';

export class DashboardController extends BaseController {
  constructor(
    templateHelpers: TemplateHelpers,
    private ta: Ta,
    private dashboardConfigService: DashboardConfigService,
    private aiStatusService: AiStatusService
  ) {
    super(templateHelpers);
  }

  registerRoutes(router: express.Router): void {
    router.get('/', async (req: any, res: any) => {
      const periods = this.dashboardConfigService.getPeriods();
      const pairs = this.dashboardConfigService.getPairs();
      const data = await this.ta.getTaForPeriods(periods, pairs);

      // Get AI status for display
      const aiStatusDisplay = this.aiStatusService.getStatusDisplay();
      const aiStatusDetail = this.aiStatusService.getStatusDetail();

      res.render('dashboard', {
        activePage: 'dashboard',
        title: 'Dashboard | Crypto Bot',
        periods: data.periods,
        rows: Object.values(data.rows),
        aiStatus: {
          ...aiStatusDisplay,
          provider: aiStatusDetail.provider,
          signalsValidated: aiStatusDetail.totalSignalsValidated,
          signalsAccepted: aiStatusDetail.totalSignalsAccepted,
          signalsRejected: aiStatusDetail.totalSignalsRejected
        }
      });
    });
  }
}
