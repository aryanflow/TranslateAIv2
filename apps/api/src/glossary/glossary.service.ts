import { Injectable, NotFoundException } from '@nestjs/common';
import {
  termPreferenceCreateSchema,
  termPreferencePatchSchema,
} from '@aptos-translate/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class GlossaryService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(tenantId: string, sourceLang: string, targetLang: string) {
    return { tenantId, sourceLang, targetLang };
  }

  async list(
    tenantId: string,
    sourceLang: string,
    targetLang: string,
    page: number,
    search: string | undefined,
  ) {
    const take = 20;
    const skip = (page - 1) * take;
    const where: Prisma.TermPreferenceWhereInput = {
      ...this.scope(tenantId, sourceLang, targetLang),
      ...(search?.trim()
        ? { sourceTerm: { contains: search.trim(), mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.termPreference.findMany({
        where,
        skip,
        take,
        orderBy: { sourceTerm: 'asc' },
      }),
      this.prisma.termPreference.count({ where }),
    ]);
    return { items, page, pageSize: take, total };
  }

  addTerm(tenantId: string, body: unknown) {
    const parsed = termPreferenceCreateSchema.parse(body);
    return this.prisma.termPreference.create({
      data: {
        tenantId,
        sourceLang: parsed.sourceLang,
        targetLang: parsed.targetLang,
        sourceTerm: parsed.sourceTerm,
        preferredTarget: parsed.preferredTarget,
        notes: parsed.notes,
      },
    });
  }

  async updateTerm(tenantId: string, id: string, body: unknown) {
    const parsed = termPreferencePatchSchema.parse(body);
    const row = await this.prisma.termPreference.findFirst({
      where: { id, tenantId },
    });
    if (!row) {
      throw new NotFoundException();
    }
    return this.prisma.termPreference.update({
      where: { id },
      data: {
        ...(parsed.sourceTerm != null ? { sourceTerm: parsed.sourceTerm } : {}),
        ...(parsed.preferredTarget != null
          ? { preferredTarget: parsed.preferredTarget }
          : {}),
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
      },
    });
  }

  async deleteTerm(tenantId: string, id: string) {
    const row = await this.prisma.termPreference.findFirst({
      where: { id, tenantId },
    });
    if (!row) {
      throw new NotFoundException();
    }
    await this.prisma.termPreference.delete({ where: { id } });
    return { deleted: true, id };
  }
}
