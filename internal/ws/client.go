package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
)

func NewClient(hub *Hub, conn *websocket.Conn, userID string, logger *slog.Logger) *Client {
	c := &Client{
		hub:    hub,
		conn:   conn,
		userID: userID,
		send:   make(chan []byte, 256),
	}

	hub.Register(c)
	go c.writePump(logger)
	go c.readPump(logger)
	return c
}

func (c *Client) readPump(logger *slog.Logger) {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				logger.Error("WebSocket read error", "user_id", c.userID, "error", err)
			}
			break
		}
		var wsMsg struct {
			Event string `json:"event"`
			Data  struct {
				ChatID string `json:"chat_id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(message, &wsMsg); err != nil {
			logger.Warn("invalid ws message", "user_id", c.userID, "raw", string(message))
			continue
		}

		switch wsMsg.Event {
		case "typing":
			if wsMsg.Data.ChatID != "" {
				c.hub.BroadcastTyping(context.Background(), c.userID, wsMsg.Data.ChatID)
			}
		case "stop_typing":
			if wsMsg.Data.ChatID != "" {
				c.hub.BroadcastStopTyping(context.Background(), c.userID, wsMsg.Data.ChatID)
			}
		default:
			logger.Debug("unknown ws event", "event", wsMsg.Event)
		}
	}
}

func (c *Client) writePump(logger *slog.Logger) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				logger.Error("WebSocket write error", "user_id", c.userID, "error", err)
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
