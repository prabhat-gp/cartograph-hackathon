package com.shop.orders;

import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderRepository extends JpaRepository<OrderDto, String> {
    void deleteStale();
}
