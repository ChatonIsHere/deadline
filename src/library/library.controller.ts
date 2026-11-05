import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { type Me, regionInput, type RegionInput } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { LibraryService } from './library.service';

const MAX_UPLOAD = 15 * 1024 * 1024;

@Controller('api/library')
@UseGuards(AuthGuard)
export class LibraryController {
    constructor(private readonly library: LibraryService) {}

    @Get()
    list() {
        return this.library.list();
    }

    /**
     * Multipart upload with a `file`. `kind=avatar` makes a square runner picture (anyone).
     * Otherwise it's a gig picture: `library=true` adds it to the library (admins), else
     * it's a one-off for a gig (fixers and admins). `regionId` files it under a region.
     */
    @Post('images')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD } }))
    async upload(
        @CurrentUser() user: Me,
        @UploadedFile() file: Express.Multer.File | undefined,
        @Body() body: { regionId?: string; library?: string; kind?: string },
    ) {
        if (!file) throw new BadRequestException('No file.');
        const kind = body.kind === 'avatar' ? 'avatar' : 'gig';
        const regionId = body.regionId && kind === 'gig' ? Number(body.regionId) : null;
        const inLibrary = body.library === 'true' && kind === 'gig';
        return { id: await this.library.upload(user, file.buffer, { regionId, inLibrary, kind }) };
    }

    @Delete('images/:id')
    @HttpCode(204)
    remove(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        this.library.remove(user, id);
    }

    @Post('regions')
    @HttpCode(204)
    addRegion(@CurrentUser() user: Me, @Body(new ZodPipe(regionInput)) body: RegionInput) {
        this.library.addRegion(user, body);
    }

    @Delete('regions/:id')
    @HttpCode(204)
    deleteRegion(@CurrentUser() user: Me, @Param('id', ParseIntPipe) id: number) {
        this.library.deleteRegion(user, id);
    }
}
