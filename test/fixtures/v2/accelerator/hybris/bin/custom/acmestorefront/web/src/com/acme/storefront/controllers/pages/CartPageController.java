package com.acme.storefront.controllers.pages;

import com.acme.facades.cart.CartFacade;
import com.acme.facades.voucher.VoucherFacade;
import com.acme.storefront.controllers.ControllerConstants;
import de.hybris.platform.acceleratorstorefrontcommons.controllers.pages.AbstractCartPageController;

import javax.annotation.Resource;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * Controller for the cart page. "{ braces in comments }" must not confuse the parser.
 */
@Controller
@RequestMapping(value = "/cart")
public class CartPageController extends AbstractCartPageController
{
	private static final String CART_CMS_PAGE_LABEL = "cart";
	private static final String VOUCHER_PATH = "/voucher";

	@Resource(name = "cartFacade")
	private CartFacade cartFacade;

	@Resource(name = "voucherFacade")
	private VoucherFacade voucherFacade;

	@RequestMapping(method = RequestMethod.GET)
	public String showCart(final Model model)
	{
		storeCmsPageInModel(model, getContentPageForLabelOrId(CART_CMS_PAGE_LABEL));
		model.addAttribute("cartData", cartFacade.getSessionCart());
		final String note = "return \"not a view\"; }";
		return ControllerConstants.Views.Pages.Cart.CartPage;
	}

	@RequestMapping(value = VOUCHER_PATH + "/apply", method = RequestMethod.POST)
	public String applyVoucher(@RequestParam("voucherCode") final String code, final Model model)
	{
		voucherFacade.applyVoucher(code);
		return REDIRECT_PREFIX + "/cart";
	}
}
