package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/McDouglas-Go/messenger/internal/auth"
	"github.com/McDouglas-Go/messenger/internal/ws"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // для разработки
	},
}

type WSHandler struct {
	hub        *ws.Hub
	jwtManager *auth.JWTManager
	logger     *slog.Logger
}

func NewWSHandler(hub *ws.Hub, jwtManager *auth.JWTManager, logger *slog.Logger) *WSHandler {
	return &WSHandler{hub: hub, jwtManager: jwtManager, logger: logger}
}

func (h *WSHandler) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("WebSocket upgrade failed", "error", err)
		return
	}

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, msgBytes, err := conn.ReadMessage()
	if err != nil {
		h.logger.Warn("no auth message received", "error", err)
		conn.Close()
		return
	}

	var authMsg struct {
		Event string `json:"event"`
		Data  struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(msgBytes, &authMsg); err != nil || authMsg.Event != "auth" || authMsg.Data.Token == "" {
		h.logger.Warn("invalid auth message")
		conn.Close()
		return
	}

	claims, err := h.jwtManager.Verify(authMsg.Data.Token)
	if err != nil {
		h.logger.Warn("invalid token in ws auth", "error", err)
		conn.Close()
		return
	}

	conn.SetReadDeadline(time.Time{})
	conn.WriteJSON(map[string]string{"event": "auth_ok"})

	ws.NewClient(h.hub, conn, claims.UserID, h.logger)
}
