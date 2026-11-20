package com.acme.core.jobs;

import de.hybris.platform.servicelayer.cronjob.AbstractJobPerformable;

public class CartCleanupJob extends AbstractJobPerformable<CronJobModel>
{
	@Override
	public PerformResult perform(final CronJobModel cronJob)
	{
		return new PerformResult(CronJobResult.SUCCESS, CronJobStatus.FINISHED);
	}
}
