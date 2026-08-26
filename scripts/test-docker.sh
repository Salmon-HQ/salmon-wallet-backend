#!/bin/bash

# Script para ejecutar tests en Docker
# Uso: ./scripts/test-docker.sh [opciones]
#
# Opciones:
#   all        - Ejecutar todos los tests (default)
#   unit       - Ejecutar solo tests unitarios
#   integration - Ejecutar solo tests de integración
#   helius     - Ejecutar solo tests de Helius
#   coverage   - Ejecutar tests con coverage

set -e

# Colores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TEST_TYPE=${1:-all}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Salmon API - Docker Test Runner${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Verificar que Docker Compose esté corriendo
if ! docker-compose ps | grep -q "salmon-api.*Up"; then
    echo -e "${YELLOW}⚠️  Warning: salmon-api container no está corriendo${NC}"
    echo -e "${YELLOW}   Ejecuta: docker-compose up -d${NC}"
    echo ""
fi

# Ejecutar tests según tipo
case $TEST_TYPE in
    all)
        echo -e "${GREEN}▶ Ejecutando TODOS los tests...${NC}"
        docker-compose exec -T api npm test
        ;;
    unit)
        echo -e "${GREEN}▶ Ejecutando tests unitarios...${NC}"
        docker-compose exec -T api npm run test:unit
        ;;
    integration)
        echo -e "${GREEN}▶ Ejecutando tests de integración...${NC}"
        docker-compose exec -T api npm run test:integration
        ;;
    helius)
        echo -e "${GREEN}▶ Ejecutando tests de Helius...${NC}"
        docker-compose exec -T api npm run test:helius
        ;;
    coverage)
        echo -e "${GREEN}▶ Ejecutando tests con coverage...${NC}"
        docker-compose exec -T api npm run test:coverage
        ;;
    *)
        echo -e "${YELLOW}Tipo de test desconocido: $TEST_TYPE${NC}"
        echo ""
        echo "Uso: ./scripts/test-docker.sh [all|unit|integration|helius|coverage]"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}✓ Tests completados${NC}"
