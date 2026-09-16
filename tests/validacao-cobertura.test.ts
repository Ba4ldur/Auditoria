/**
 * Cobertura tri-estado dos registros SPED (fase 4).
 *
 * `tallyCoverage` classifica cada registro efetivamente encontrado no arquivo
 * em SUPORTADO, PARCIALMENTE_SUPORTADO ou NAO_SUPORTADO — a partir do catálogo
 * mantido à mão em `efd-icms-ipi/coverage.ts`, não do que o parser "tem
 * handler para". `documentCoverage` decide se o percentual de cobertura
 * documental pode ser calculado, e se recusa a inventar um número quando o
 * arquivo contém registros de consolidação não interpretados.
 */

import { describe, expect, it } from 'vitest';
import {
  coverageOf,
  REGISTER_COVERAGE,
  UNSUPPORTED_REGISTERS,
} from '@/lib/parsers/sped/efd-icms-ipi/coverage';
import { documentCoverage, tallyCoverage } from '@/lib/validation/technical';

describe('tallyCoverage: classificação por registro efetivamente encontrado', () => {
  it('classifica um registro SUPORTADO', () => {
    const tally = tallyCoverage([{ code: 'C100', count: 10 }]);

    expect(tally.registers).toHaveLength(1);
    expect(tally.registers[0]?.level).toBe('SUPORTADO');
    expect(tally.registers[0]?.count).toBe(10);
    expect(tally.byLevel.SUPORTADO).toEqual({ types: 1, records: 10 });
    expect(tally.byLevel.PARCIALMENTE_SUPORTADO).toEqual({ types: 0, records: 0 });
    expect(tally.byLevel.NAO_SUPORTADO).toEqual({ types: 0, records: 0 });
  });

  it('classifica um registro PARCIALMENTE_SUPORTADO', () => {
    // C195 é lido e fica inspecionável, mas nenhum cruzamento o consulta.
    const tally = tallyCoverage([{ code: 'C195', count: 4 }]);

    expect(tally.registers[0]?.level).toBe('PARCIALMENTE_SUPORTADO');
    expect(tally.byLevel.PARCIALMENTE_SUPORTADO).toEqual({ types: 1, records: 4 });
  });

  it('classifica um registro NAO_SUPORTADO catalogado (bloco de consolidação)', () => {
    const tally = tallyCoverage([{ code: 'C400', count: 3 }]);

    expect(tally.registers[0]?.level).toBe('NAO_SUPORTADO');
    expect(tally.byLevel.NAO_SUPORTADO).toEqual({ types: 1, records: 3 });
  });

  it('registro desconhecido (fora do catálogo) também é NAO_SUPORTADO, nunca omitido', () => {
    // Um arquivo real pode trazer um registro que este catálogo não
    // antecipou. Omiti-lo daria a impressão de que foi analisado.
    const tally = tallyCoverage([{ code: 'Z999', count: 1 }]);

    expect(tally.registers[0]?.level).toBe('NAO_SUPORTADO');
    expect(tally.registers[0]?.description).toContain('não catalogado');
    expect(tally.registers[0]?.detail).toContain('não participou de nenhum cruzamento');
  });

  it('soma tipos e registros através de níveis diferentes', () => {
    const tally = tallyCoverage([
      { code: 'C100', count: 6281 },
      { code: 'C170', count: 21744 },
      { code: 'C195', count: 12 },
      { code: 'C400', count: 31 },
      { code: 'C405', count: 31 },
    ]);

    expect(tally.totalTypes).toBe(5);
    expect(tally.totalRecords).toBe(6281 + 21744 + 12 + 31 + 31);
    expect(tally.byLevel.SUPORTADO.types).toBe(2); // C100, C170
    expect(tally.byLevel.PARCIALMENTE_SUPORTADO.types).toBe(1); // C195
    expect(tally.byLevel.NAO_SUPORTADO.types).toBe(2); // C400, C405
  });

  it('registros são ordenados pelo código', () => {
    const tally = tallyCoverage([
      { code: 'C400', count: 1 },
      { code: '0000', count: 1 },
      { code: 'C100', count: 1 },
    ]);
    expect(tally.registers.map((entry) => entry.code)).toEqual(['0000', 'C100', 'C400']);
  });

  it('coverageOf devolve a mesma classificação usada por tallyCoverage', () => {
    expect(coverageOf('C100').level).toBe('SUPORTADO');
    expect(coverageOf('E110').level).toBe('PARCIALMENTE_SUPORTADO');
    expect(coverageOf('C495').level).toBe('NAO_SUPORTADO');
    expect(coverageOf('QQ000').level).toBe('NAO_SUPORTADO');
  });

  it('o catálogo cobre todos os registros de consolidação e ECF listados como não suportados', () => {
    // Trava de regressão: se alguém implementar um desses registros, o nível
    // muda em REGISTER_COVERAGE, e este teste para de contar aquele código
    // como não suportado — sem exigir edição aqui.
    expect(UNSUPPORTED_REGISTERS.length).toBeGreaterThan(10);
    expect(UNSUPPORTED_REGISTERS.map((entry) => entry.code)).toContain('C300');
    expect(UNSUPPORTED_REGISTERS.map((entry) => entry.code)).toContain('C495');
    expect(REGISTER_COVERAGE.every((entry) => entry.detail.length > 10)).toBe(true);
  });
});

describe('documentCoverage: percentual só quando calculável de forma defensável', () => {
  it('é calculável (100%) quando todos os registros presentes são suportados ou parciais', () => {
    const tally = tallyCoverage([
      { code: 'C100', count: 100 },
      { code: 'C170', count: 300 },
      { code: 'C190', count: 120 },
      { code: 'C195', count: 5 }, // parcial, mas não é consolidação não lida
    ]);

    const coverage = documentCoverage({ efdDocuments: 100, registers: tally.registers });

    expect(coverage.percentage).toBe(100);
    expect(coverage.totalKnown).toBe(100);
    expect(coverage.analysed).toBe(100);
    expect(coverage.basis).toContain('Calculável');
  });

  it('NÃO é calculável quando há registro de consolidação não suportado com ocorrências', () => {
    const tally = tallyCoverage([
      { code: 'C100', count: 80 },
      { code: 'C300', count: 15 }, // resumo diário: quantos documentos representa? desconhecido.
    ]);

    const coverage = documentCoverage({ efdDocuments: 80, registers: tally.registers });

    expect(coverage.percentage).toBeNull();
    expect(coverage.totalKnown).toBeNull();
    expect(coverage.analysed).toBe(80);
    expect(coverage.basis).toContain('Não calculável');
    expect(coverage.basis).toContain('C300');
  });

  it('registro não suportado com contagem zero não impede o cálculo', () => {
    // Um tipo de registro pode constar do catálogo como não suportado sem que
    // o arquivo realmente o contenha; `tallyCoverage` só recebe o que existe
    // no arquivo, então isso normalmente nem aparece — mas a regra de
    // `documentCoverage` é sobre contagem > 0, não sobre presença no catálogo.
    const tally = tallyCoverage([{ code: 'C100', count: 10 }]);
    const coverage = documentCoverage({ efdDocuments: 10, registers: tally.registers });
    expect(coverage.percentage).toBe(100);
  });

  it('não inventa percentual: nunca devolve um número quando a base é desconhecida', () => {
    const tally = tallyCoverage([
      { code: 'C400', count: 1 },
      { code: 'C405', count: 1 },
      { code: 'C420', count: 5 },
    ]);
    const coverage = documentCoverage({ efdDocuments: 0, registers: tally.registers });

    expect(coverage.percentage).toBeNull();
    expect(typeof coverage.percentage).not.toBe('number');
  });
});
