package ws

import (
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/gorilla/websocket"
)

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	userID string
	send   chan []byte
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]bool
	logger  *slog.Logger
}

func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		clients: make(map[string]map[*Client]bool),
		logger:  logger,
	}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[c.userID] == nil {
		h.clients[c.userID] = make(map[*Client]bool)
	}
	h.clients[c.userID][c] = true
	h.logger.Info("WebSocket client connected", "user_id", c.userID)
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.clients[c.userID]; ok {
		if _, exists := clients[c]; exists {
			delete(clients, c)
			close(c.send)
			if len(clients) == 0 {
				delete(h.clients, c.userID)
			}
		}
	}
	h.logger.Info("WebSocket client disconnected", "user_id", c.userID)
}

func (h *Hub) SendToUser(userID string, message interface{}) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	clients, ok := h.clients[userID]
	if !ok {
		return nil
	}
	for client := range clients {
		select {
		case client.send <- data:
		default:
			go h.Unregister(client)
			client.conn.Close()
		}
	}

	return nil
}
