package com.shop.orders;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }

    public OrderDto find(String id) {
        return repository.findById(id).orElseThrow();
    }

    public OrderDto place(OrderDto order) {
        return repository.save(order);
    }

    @Scheduled(cron = "0 0 * * * *")
    public void expireStaleOrders() {
        repository.deleteStale();
    }

    @KafkaListener(topics = "payments")
    public void onPayment(String message) {
        find(message);
    }
}
