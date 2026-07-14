/**
 * 人脸识别交互优化模块
 * 在照片详情页展示识别出的人物标签，支持点击标签快速筛选相关照片
 */

export interface PersonTag {
  personId: string;
  name: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  avatar?: string;
}

export interface PhotoWithFaces {
  photoId: string;
  photoUrl: string;
  faces: PersonTag[];
  uploadedAt: number;
  uploadedBy: string;
}

export interface PersonProfile {
  personId: string;
  name: string;
  avatar?: string;
  photoCount: number;
  firstSeen: number;
  lastSeen: number;
  confidence: number;
}

class FaceRecognitionInteraction {
  private photoFaces: Map<string, PhotoWithFaces> = new Map();
  private personProfiles: Map<string, PersonProfile> = new Map();
  private personPhotoIndex: Map<string, Set<string>> = new Map();

  /**
   * 添加照片人脸数据
   */
  addPhotoWithFaces(photoData: PhotoWithFaces): void {
    this.photoFaces.set(photoData.photoId, photoData);

    // 更新人物索引
    for (const face of photoData.faces) {
      if (!this.personPhotoIndex.has(face.personId)) {
        this.personPhotoIndex.set(face.personId, new Set());
      }
      this.personPhotoIndex.get(face.personId)!.add(photoData.photoId);

      // 更新人物档案
      this.updatePersonProfile(face);
    }

    console.log(`Photo with ${photoData.faces.length} faces added: ${photoData.photoId}`);
  }

  /**
   * 更新人物档案
   */
  private updatePersonProfile(face: PersonTag): void {
    if (!this.personProfiles.has(face.personId)) {
      this.personProfiles.set(face.personId, {
        personId: face.personId,
        name: face.name,
        avatar: face.avatar,
        photoCount: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        confidence: face.confidence,
      });
    } else {
      const profile = this.personProfiles.get(face.personId)!;
      profile.photoCount++;
      profile.lastSeen = Date.now();
      profile.confidence = Math.max(profile.confidence, face.confidence);
    }
  }

  /**
   * 获取照片的人物标签
   */
  getPhotoFaces(photoId: string): PersonTag[] {
    return this.photoFaces.get(photoId)?.faces || [];
  }

  /**
   * 按人物筛选照片
   */
  getPhotosByPerson(personId: string): PhotoWithFaces[] {
    const photoIds = this.personPhotoIndex.get(personId) || new Set();
    return Array.from(photoIds)
      .map(id => this.photoFaces.get(id))
      .filter((photo): photo is PhotoWithFaces => photo !== undefined);
  }

  /**
   * 获取人物档案
   */
  getPersonProfile(personId: string): PersonProfile | undefined {
    return this.personProfiles.get(personId);
  }

  /**
   * 获取所有人物档案
   */
  getAllPersonProfiles(): PersonProfile[] {
    return Array.from(this.personProfiles.values()).sort(
      (a, b) => b.photoCount - a.photoCount
    );
  }

  /**
   * 获取频繁出现的人物
   */
  getFrequentPeople(limit: number = 10): PersonProfile[] {
    return this.getAllPersonProfiles().slice(0, limit);
  }

  /**
   * 获取最近出现的人物
   */
  getRecentPeople(days: number = 30, limit: number = 10): PersonProfile[] {
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    return Array.from(this.personProfiles.values())
      .filter(p => p.lastSeen >= cutoffTime)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, limit);
  }

  /**
   * 搜索人物
   */
  searchPeople(query: string): PersonProfile[] {
    const lowerQuery = query.toLowerCase();

    return Array.from(this.personProfiles.values()).filter(p =>
      p.name.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 合并人物档案（处理重复识别）
   */
  mergePeople(sourcePerson: string, targetPerson: string): void {
    const sourcePhotos = this.personPhotoIndex.get(sourcePerson) || new Set();
    const targetPhotos = this.personPhotoIndex.get(targetPerson) || new Set();

    // 合并照片索引
    sourcePhotos.forEach(photoId => {
      targetPhotos.add(photoId);
      const photo = this.photoFaces.get(photoId);
      if (photo) {
        photo.faces = photo.faces.map(face =>
          face.personId === sourcePerson ? { ...face, personId: targetPerson } : face
        );
      }
    });

    // 更新人物档案
    const sourceProfile = this.personProfiles.get(sourcePerson);
    const targetProfile = this.personProfiles.get(targetPerson);

    if (sourceProfile && targetProfile) {
      targetProfile.photoCount += sourceProfile.photoCount;
      targetProfile.firstSeen = Math.min(targetProfile.firstSeen, sourceProfile.firstSeen);
      targetProfile.lastSeen = Math.max(targetProfile.lastSeen, sourceProfile.lastSeen);
      targetProfile.confidence = Math.max(targetProfile.confidence, sourceProfile.confidence);
    }

    this.personPhotoIndex.delete(sourcePerson);
    this.personProfiles.delete(sourcePerson);

    console.log(`People merged: ${sourcePerson} -> ${targetPerson}`);
  }

  /**
   * 重命名人物
   */
  renamePerson(personId: string, newName: string): void {
    const profile = this.personProfiles.get(personId);
    if (profile) {
      profile.name = newName;
      console.log(`Person renamed: ${personId} -> ${newName}`);
    }
  }

  /**
   * 获取人物统计
   */
  getStats(): {
    totalPhotos: number;
    totalPeople: number;
    averageFacesPerPhoto: number;
    averagePhotosPerPerson: number;
  } {
    const totalPhotos = this.photoFaces.size;
    const totalPeople = this.personProfiles.size;
    const totalFaces = Array.from(this.photoFaces.values()).reduce(
      (sum, photo) => sum + photo.faces.length,
      0
    );

    return {
      totalPhotos,
      totalPeople,
      averageFacesPerPhoto: totalPhotos > 0 ? totalFaces / totalPhotos : 0,
      averagePhotosPerPerson: totalPeople > 0 ? totalPhotos / totalPeople : 0,
    };
  }

  /**
   * 清空数据
   */
  clearData(): void {
    this.photoFaces.clear();
    this.personProfiles.clear();
    this.personPhotoIndex.clear();
    console.log("Face recognition interaction data cleared");
  }
}

// 导出单例
export const faceRecognitionInteraction = new FaceRecognitionInteraction();
