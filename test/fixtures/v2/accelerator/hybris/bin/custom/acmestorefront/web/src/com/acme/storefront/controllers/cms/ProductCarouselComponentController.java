package com.acme.storefront.controllers.cms;

import com.acme.facades.cart.ProductCarouselFacade;
import com.acme.storefront.controllers.ControllerConstants;
import de.hybris.platform.addonsupport.controllers.cms.AbstractAcceleratorCMSComponentController;
import javax.annotation.Resource;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller("ProductCarouselComponentController")
@RequestMapping(value = ControllerConstants.Actions.Cms.ProductCarouselComponent)
public class ProductCarouselComponentController extends AbstractAcceleratorCMSComponentController<ProductCarouselComponentModel>
{
	@Resource(name = "productCarouselFacade")
	private ProductCarouselFacade productCarouselFacade;

	@Override
	protected void fillModel(final HttpServletRequest request, final Model model, final ProductCarouselComponentModel component)
	{
		model.addAttribute("productData", productCarouselFacade.collectProducts(component));
	}
}
