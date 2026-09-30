import { Controller, Get, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { GeocodeService } from '../sources/geocode/geocode.service';

@Controller('api')
export class GeoController {
  constructor(private readonly geocode: GeocodeService) {}

  @Get('place')
  async place(@Query('q') q: string) {
    if (!q?.trim()) throw new BadRequestException('q is required');
    const place = await this.geocode.findPlace(q.trim());
    if (!place) throw new NotFoundException(`Couldn't find "${q}"`);
    return place;
  }
}
