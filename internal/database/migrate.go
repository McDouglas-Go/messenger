package database

import (
	"embed"
	"fmt"
	"log"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed migrations/*.sql
var migtarionFS embed.FS

func RunMigrations(databaseURL string) error {
	source, err := iofs.New(migtarionFS, "migrations")
	if err != nil {
		return fmt.Errorf("create io/fs source: %w", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", source, databaseURL)
	if err != nil {
		return fmt.Errorf("create migrate instance: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("rum migrations: %w", err)
	}

	log.Println("migrations completed succesfully")
	return nil
}
