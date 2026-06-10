package handlers

import (
	"log/slog"
	"net/http"

	"github.com/McDouglas-Go/messenger/internal/middleware"
	"github.com/McDouglas-Go/messenger/internal/ws"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WSHandler struct {
	hub    *ws.Hub
	logger *slog.Logger
}

func NewWSHandler(hub *ws.Hub, logger *slog.Logger) *WSHandler {
	return &WSHandler{
		hub:    hub,
		logger: logger,
	}
}

func (h *WSHandler) ServeWS(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("WebSocket upgrade failed", "error", err)
		return
	}

	ws.NewClient(h.hub, conn, claims.UserID, h.logger)
}
