package com.acme.core.actions;

import de.hybris.platform.processengine.action.AbstractProceduralAction;

public class SendOrderConfirmationEmailAction extends AbstractProceduralAction<OrderProcessModel>
{
	@Override
	public void executeAction(final OrderProcessModel process)
	{
		// send the email
	}
}
