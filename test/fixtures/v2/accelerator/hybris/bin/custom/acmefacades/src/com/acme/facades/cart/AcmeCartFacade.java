package com.acme.facades.cart;

/** Project override of the default cart facade, wired through the cartFacade alias. */
public class AcmeCartFacade extends DefaultCartFacade
{
	@Override
	public CartData getSessionCart()
	{
		final CartData cart = super.getSessionCart();
		markLoyalty(cart);
		return cart;
	}

	private void markLoyalty(final CartData cart)
	{
		// nothing
	}
}
