package com.acme.core.event;

import de.hybris.platform.acceleratorservices.site.AbstractAcceleratorSiteEventListener;

public class OrderConfirmationEventListener extends AbstractAcceleratorSiteEventListener<OrderPlacedEvent>
{
	@Override
	protected void onSiteEvent(final OrderPlacedEvent event)
	{
		getBusinessProcessService().startProcess("order-process");
	}
}
