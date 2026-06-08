package handlers

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/McDouglas-Go/messenger/internal/middleware"
	"github.com/McDouglas-Go/messenger/internal/service"
	"github.com/gorilla/mux"
)

type MediaHandler struct {
	MediaService service.MediaService
	log          *slog.Logger
}

func NewMediahandler(mediaService service.MediaService, logger *slog.Logger) *MediaHandler {
	return &MediaHandler{MediaService: mediaService, log: logger}
}

func (h *MediaHandler) Upload(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, 30<<30)

	if err := r.ParseMultipartForm(30 << 30); err != nil {
		http.Error(w, "File too large or invalid form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Missing 'file' field", http.StatusBadRequest)
		return
	}
	defer file.Close()

	messageIDStr := r.FormValue("message_id")
	var messageID *string
	if messageIDStr != "" {
		messageID = &messageIDStr
	}

	mimeType := r.FormValue("mime_type")
	var userID *string
	if messageID == nil {
		userID = &claims.UserID
	}
	media, err := h.MediaService.Upload(r.Context(), file, header, messageID, userID, mimeType)
	if err != nil {
		h.log.Error("Upload failed", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"id":         media.ID,
		"size_bytes": media.SizeBytes,
		"mime_type":  media.MimeType,
		"created_at": media.UploadedAt.Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(resp)
}

func (h *MediaHandler) Download(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())
	id := mux.Vars(r)["id"]
	if id == "" {
		http.Error(w, "Missing media ID", http.StatusBadRequest)
		return
	}

	media, err := h.MediaService.Get(r.Context(), id, claims.UserID)
	if err != nil {
		h.log.Error("Get media failed", "error", err)
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	file, err := os.Open(media.FilePath)
	if err != nil {
		h.log.Error("Open file failed", "error", err)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", media.MimeType)
	w.Header().Set("Content-Length", strconv.FormatInt(media.SizeBytes, 10))
	io.Copy(w, file)
}
